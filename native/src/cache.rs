use std::sync::{Mutex, MutexGuard};

use napi::{Error, Result, Status};
use napi_derive::napi;
use rusqlite::{Connection, OptionalExtension, params};

use crate::{db_err, now_secs};

/// A small key/value cache in SQLite with a per-entry expiry, for API
/// responses that should survive a restart but not live forever.
#[napi]
pub struct Cache {
    conn: Mutex<Connection>,
}

#[napi]
impl Cache {
    #[napi(constructor)]
    pub fn new(path: String) -> Result<Self> {
        let conn = Connection::open(path).map_err(db_err)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS cache (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL,
               expires_at INTEGER NOT NULL
             );",
        )
        .map_err(db_err)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn conn(&self) -> Result<MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| Error::new(Status::GenericFailure, "cache: lock poisoned"))
    }

    /// The stored value, or null when missing or expired.
    #[napi]
    pub fn get(&self, key: String) -> Result<Option<String>> {
        self.conn()?
            .query_row(
                "SELECT value FROM cache WHERE key = ?1 AND expires_at > ?2",
                params![key, now_secs()],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_err)
    }

    #[napi]
    pub fn set(&self, key: String, value: String, ttl_seconds: u32) -> Result<()> {
        self.conn()?
            .execute(
                "INSERT INTO cache (key, value, expires_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
                params![key, value, now_secs() + i64::from(ttl_seconds)],
            )
            .map(|_| ())
            .map_err(db_err)
    }

    /// Deletes every key that starts with `prefix` and returns how many went.
    #[napi]
    pub fn delete_prefix(&self, prefix: String) -> Result<u32> {
        let escaped = prefix
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        self.conn()?
            .execute(
                "DELETE FROM cache WHERE key LIKE ?1 ESCAPE '\\'",
                params![format!("{escaped}%")],
            )
            .map(|n| n as u32)
            .map_err(db_err)
    }

    /// Removes expired rows and returns how many went.
    #[napi]
    pub fn purge_expired(&self) -> Result<u32> {
        self.conn()?
            .execute(
                "DELETE FROM cache WHERE expires_at <= ?1",
                params![now_secs()],
            )
            .map(|n| n as u32)
            .map_err(db_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn respects_expiry_and_prefix_delete() {
        let cache = Cache::new(":memory:".into()).unwrap();
        cache.set("spotify:a".into(), "1".into(), 60).unwrap();
        cache.set("spotify_b".into(), "2".into(), 60).unwrap();
        cache.set("dead".into(), "3".into(), 0).unwrap();
        assert_eq!(cache.get("spotify:a".into()).unwrap().as_deref(), Some("1"));
        assert_eq!(cache.get("dead".into()).unwrap(), None);
        assert_eq!(cache.purge_expired().unwrap(), 1);
        // `_` is a LIKE wildcard; the escape keeps spotify_b.
        assert_eq!(cache.delete_prefix("spotify:".into()).unwrap(), 1);
        assert_eq!(cache.get("spotify_b".into()).unwrap().as_deref(), Some("2"));
    }
}
