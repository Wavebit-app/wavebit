import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { currentUi, setUi } from '../../app/ui';
import { useSizeClass } from '../../lib/useBreakpoint';
import {
  directAudioElement,
  player,
  useDirectVideo,
  useStreaming,
} from './player';
import { BACKDROP_MASK, useVideoStage } from './videoStage';
import { youtubeEmbed } from './youtubeEmbed';

/** Off screen the player keeps a real size, and keeps playing. */
const OFF_SCREEN: CSSProperties = {
  left: -10_000,
  top: 0,
  width: 356,
  height: 200,
};
const MASKS: Record<string, string> = {
  hero: BACKDROP_MASK,
  strip: 'linear-gradient(#000 62%, transparent)',
};

interface Placement {
  rect: DOMRect;
  /** How much of the surface has scrolled out of its column, top and bottom. */
  clipTop: number;
  clipBottom: number;
}

/** The live box of the surface the video is placed over, followed every frame while shown. */
function useSurfaceBox(surface: HTMLElement | null, active: boolean) {
  const [box, setBox] = useState<Placement | null>(null);
  useEffect(() => {
    if (!surface || !active) {
      setBox(null);
      return;
    }
    const column = surface.closest('[data-video-scroll]');
    let frame = 0;
    let last = '';
    const follow = () => {
      const rect = surface.getBoundingClientRect();
      const bounds = column?.getBoundingClientRect();
      const clipTop = bounds ? Math.max(0, bounds.top - rect.top) : 0;
      const clipBottom = bounds ? Math.max(0, rect.bottom - bounds.bottom) : 0;
      const key = `${rect.x}|${rect.y}|${rect.width}|${rect.height}|${clipTop}|${clipBottom}`;
      if (key !== last) {
        last = key;
        setBox({ rect, clipTop, clipBottom });
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [surface, active]);
  return box;
}

/** A 16:9 box that covers `rect`, centred, as a video backdrop is cropped. */
function coverBox(rect: DOMRect): CSSProperties {
  const width = Math.max(rect.width, (rect.height * 16) / 9);
  const height = (width * 9) / 16;
  return {
    position: 'absolute',
    width,
    height,
    left: (rect.width - width) / 2,
    top: (rect.height - height) / 2,
  };
}

/**
 * Where YouTube's embedded player lives (DESIGN.md › Player › Streams). It
 * takes the box of the surface showing it: the top of the Now playing drawer,
 * where it is a backdrop fading into the column, or the full-screen player.
 * With no surface it plays off screen. A video starting opens the drawer. The
 * iframe inside is created once, never moved.
 */
export function YouTubeStage() {
  const streaming = useStreaming();
  const compact = useSizeClass() === 'compact';
  const { surface, hidden } = useVideoStage();
  const direct = useDirectVideo();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [rendered, setRendered] = useState(false);
  const placement = useSurfaceBox(surface, streaming && !hidden);
  const host = useCallback((el: HTMLDivElement | null) => {
    youtubeEmbed.attach(el);
  }, []);

  const directVisible = direct.active && !!direct.url && !!surface && !hidden;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setRendered(false);
    if (!directVisible || !direct.url) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      return;
    }
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.controls = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = direct.url;
    video.load();
    let aligned = false;
    const sync = () => {
      const audio = directAudioElement();
      if (!audio || video.readyState < 1) return;
      const audioTime = Math.max(0, audio.currentTime);
      const drift = video.currentTime - audioTime;
      video.playbackRate = audio.playbackRate;
      if (!aligned) {
        if (Math.abs(drift) > 0.025) video.currentTime = audioTime;
        aligned = true;
      }
      if (audio.paused) {
        video.pause();
        if (!video.seeking && Math.abs(drift) > 0.04)
          video.currentTime = audioTime;
        return;
      }
      if (video.paused)
        void video.play().catch(() => player.directVideoFailed(direct.leaseId));
      if (video.readyState < 3) return;
      if (Math.abs(drift) > 0.45) video.currentTime = audioTime;
      else if (Math.abs(drift) > 0.025)
        video.playbackRate =
          audio.playbackRate * (1 + Math.max(-0.1, Math.min(0.1, -drift)));
    };
    const firstFrame = () => {
      setRendered(true);
      sync();
    };
    const failed = () => player.directVideoFailed(direct.leaseId);
    const audio = directAudioElement();
    video.addEventListener('loadedmetadata', sync);
    video.addEventListener('loadeddata', firstFrame, { once: true });
    video.addEventListener('error', failed);
    audio?.addEventListener('play', sync);
    audio?.addEventListener('pause', sync);
    audio?.addEventListener('seeking', sync);
    audio?.addEventListener('seeked', sync);
    audio?.addEventListener('ratechange', sync);
    const timer = window.setInterval(sync, 250);
    return () => {
      window.clearInterval(timer);
      video.removeEventListener('loadedmetadata', sync);
      video.removeEventListener('error', failed);
      audio?.removeEventListener('play', sync);
      audio?.removeEventListener('pause', sync);
      audio?.removeEventListener('seeking', sync);
      audio?.removeEventListener('seeked', sync);
      audio?.removeEventListener('ratechange', sync);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [direct.active, direct.url, direct.leaseId, directVisible]);

  // The video needs somewhere to be; a phone-width window keeps its one screen.
  const wantsDrawer = streaming && !hidden && !compact;
  useEffect(() => {
    if (wantsDrawer && !currentUi().panel) setUi({ panel: 'now' });
  }, [wantsDrawer]);

  const kind = surface?.dataset.videoBackdrop;
  const backdrop = !!kind && !!placement;
  const placed: CSSProperties = placement
    ? {
        left: placement.rect.x,
        top: placement.rect.y,
        width: placement.rect.width,
        height: placement.rect.height,
        ...(backdrop && {
          maskImage: MASKS[kind],
          clipPath: `inset(${placement.clipTop}px 0 ${placement.clipBottom}px 0${compact ? '' : ' round 8px 8px 0 0'})`,
        }),
      }
    : OFF_SCREEN;

  return (
    <section
      aria-label="YouTube Music video"
      aria-hidden={!streaming || hidden}
      style={placed}
      className={`fixed flex flex-col overflow-hidden bg-black ${backdrop ? 'pointer-events-none z-[15]' : 'z-50 rounded-md'} ${streaming ? '' : 'pointer-events-none invisible'}`}
    >
      <div
        ref={host}
        style={
          !direct.active && backdrop && placement
            ? coverBox(placement.rect)
            : undefined
        }
        className={`${direct.active ? 'hidden' : backdrop ? '' : 'min-h-0 flex-1'}`}
      />
      {direct.active && (
        <>
          {!rendered && (
            <div aria-hidden className="absolute inset-0 bg-black" />
          )}
          <video
            ref={videoRef}
            aria-label="Music video"
            tabIndex={-1}
            controls={false}
            disablePictureInPicture
            playsInline
            muted
            style={{
              ...(backdrop && placement ? coverBox(placement.rect) : {}),
              opacity: rendered ? 1 : 0,
              transition: 'opacity 240ms ease-out',
              objectFit: backdrop ? 'cover' : 'contain',
            }}
            className={backdrop ? '' : 'min-h-0 flex-1'}
          />
        </>
      )}
    </section>
  );
}
