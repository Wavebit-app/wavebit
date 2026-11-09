import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { currentUi, setUi } from '../../app/ui';
import { useSizeClass } from '../../lib/useBreakpoint';
import { useStreaming } from './player';
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
  const placement = useSurfaceBox(surface, streaming && !hidden);
  const host = useCallback((el: HTMLDivElement | null) => {
    if (el) youtubeEmbed.attach(el);
  }, []);

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
          clipPath: `inset(${placement.clipTop}px 0 ${placement.clipBottom}px 0)`,
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
        style={backdrop ? coverBox(placement.rect) : undefined}
        className={backdrop ? '' : 'min-h-0 flex-1'}
      />
    </section>
  );
}
