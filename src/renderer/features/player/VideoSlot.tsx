import { useRef } from 'react';
import { useStreaming } from './player';
import { useVideoStage, useVideoSurface } from './videoStage';

/**
 * A place the YouTube video shows (videoStage.ts); the stage sits over it. A
 * `backdrop` is the drawer's: the video fills it and fades into the column.
 */
export function VideoSlot({
  className,
  backdrop,
}: {
  className: string;
  backdrop?: 'hero' | 'strip';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useVideoSurface(ref);
  return (
    <div
      ref={ref}
      aria-hidden
      data-video-backdrop={backdrop}
      className={`${backdrop ? '' : 'bg-black'} ${className}`}
    />
  );
}

/** Keeps a playing video on screen at the top of the Queue and Lyrics views. */
export function VideoStrip() {
  const streaming = useStreaming();
  const hidden = useVideoStage().hidden;
  if (!streaming || hidden) return null;
  return (
    // YouTube's minimum for an embedded player is 200px, at every drawer width.
    <VideoSlot
      backdrop="strip"
      className="aspect-video min-h-[200px] w-full shrink-0"
    />
  );
}
