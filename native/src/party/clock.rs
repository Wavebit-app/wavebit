//! This device's offset from the party server's clock (BitChord's ServerClock).
//!
//! NTP cut down to one WebSocket: offset = serverMs - (t0 + t1) / 2, and the
//! sample with the smallest round trip wins, because its error is at most half
//! that trip.

use std::collections::VecDeque;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const WINDOW: usize = 12;
const SAMPLE_TTL_MS: i64 = 120_000;

/// Unix milliseconds that never step: the wall clock read once, then counted
/// from a monotonic timer, so a system clock change can't land in an offset.
pub struct Mono {
    base_ms: i64,
    start: Instant,
}

impl Mono {
    pub fn new() -> Self {
        Self {
            base_ms: wall_ms(),
            start: Instant::now(),
        }
    }

    pub fn now_ms(&self) -> i64 {
        self.base_ms + self.start.elapsed().as_millis() as i64
    }
}

pub fn wall_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

struct Sample {
    offset_ms: i64,
    round_trip_ms: i64,
    taken_at_ms: i64,
}

#[derive(Default)]
pub struct ServerClock {
    samples: VecDeque<Sample>,
    /// The winning sample's offset and round trip.
    best: Option<(i64, i64)>,
}

impl ServerClock {
    pub fn record(&mut self, sent_at_ms: i64, server_ms: i64, received_at_ms: i64) {
        let round_trip = (received_at_ms - sent_at_ms).max(0);
        self.samples.push_back(Sample {
            offset_ms: server_ms - (sent_at_ms + round_trip / 2),
            round_trip_ms: round_trip,
            taken_at_ms: received_at_ms,
        });
        while self.samples.len() > WINDOW {
            self.samples.pop_front();
        }
        let cutoff = received_at_ms - SAMPLE_TTL_MS;
        let fresh = self.samples.iter().filter(|s| s.taken_at_ms >= cutoff);
        self.best = fresh
            .min_by_key(|s| s.round_trip_ms)
            .map(|s| (s.offset_ms, s.round_trip_ms));
    }

    /// Server time minus this device's [`Mono`] time; None until the first pong.
    pub fn offset_ms(&self) -> Option<i64> {
        self.best.map(|(offset, _)| offset)
    }

    pub fn round_trip_ms(&self) -> i64 {
        self.best.map_or(0, |(_, trip)| trip)
    }

    pub fn reset(&mut self) {
        self.samples.clear();
        self.best = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offset_is_server_time_minus_the_midpoint() {
        let mut clock = ServerClock::default();
        assert_eq!(clock.offset_ms(), None);
        // Sent at 1000, back at 1100: the server stamped 5050 at our 1050.
        clock.record(1_000, 5_050, 1_100);
        assert_eq!(clock.offset_ms(), Some(4_000));
        assert_eq!(clock.round_trip_ms(), 100);
    }

    #[test]
    fn the_shortest_round_trip_wins() {
        let mut clock = ServerClock::default();
        clock.record(0, 4_200, 400); // slow: offset 4000, off by its delay
        clock.record(1_000, 5_010, 1_020); // fast: offset 4000 exactly
        clock.record(2_000, 6_500, 2_600); // slow again
        assert_eq!(clock.round_trip_ms(), 20);
        assert_eq!(clock.offset_ms(), Some(4_000));
    }

    #[test]
    fn old_samples_stop_counting() {
        let mut clock = ServerClock::default();
        clock.record(0, 4_005, 10);
        clock.record(200_000, 204_100, 200_200);
        // The 10 ms sample is two minutes stale; the fresh one is all there is.
        assert_eq!(clock.round_trip_ms(), 200);
    }

    #[test]
    fn only_the_last_twelve_are_kept() {
        let mut clock = ServerClock::default();
        clock.record(0, 0, 5);
        for i in 1..=12 {
            clock.record(i * 100, i * 100, i * 100 + 50);
        }
        assert_eq!(clock.round_trip_ms(), 50);
    }
}
