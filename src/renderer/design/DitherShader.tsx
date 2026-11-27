import { useEffect, useRef } from 'react';
import { useMotion } from '../lib/useTheme';
import { dither, parseHex, type ColorMode } from './ditherRules';

/**
 * What the shader dithers: a painter that draws into a canvas of the given
 * size. Paints are plain canvas drawing, so nothing is fetched and the CSP
 * stays as it is. `t` is seconds since the shader started, for paints that
 * move.
 */
export type DitherPaint = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  t: number,
) => void;

/** The longest the shimmer runs for before it rests on its last frame. */
const SHIMMER_FPS = 20;

/**
 * An ordered (Bayer) dither of whatever `paint` draws, in two colours, filling
 * its box. `gridSize` is one cell in CSS pixels. With `moving`, the paint is
 * redrawn at 20 frames a second while the window shows it and Motion is Full;
 * otherwise it is drawn once per size and colour.
 */
export function DitherShader({
  paint,
  gridSize = 2,
  colorMode = 'duotone',
  primaryColor,
  secondaryColor,
  threshold = 0.5,
  moving = false,
  className = '',
}: {
  paint: DitherPaint;
  gridSize?: number;
  colorMode?: ColorMode;
  primaryColor: string;
  secondaryColor: string;
  threshold?: number;
  moving?: boolean;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const motion = useMotion();
  const animate = moving && motion === 'full';
  // The latest paint without restarting the loop when a parent re-renders.
  const paintRef = useRef(paint);
  paintRef.current = paint;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const out = el.getContext('2d');
    const work = document.createElement('canvas').getContext('2d', {
      willReadFrequently: true,
    });
    if (!out || !work) return;
    const primary = parseHex(primaryColor) ?? [0, 0, 0];
    const secondary = parseHex(secondaryColor) ?? [255, 255, 255];
    const cell = Math.max(1, gridSize);
    const start = performance.now();
    let cols = 0;
    let rows = 0;

    const draw = () => {
      if (!cols || !rows) return;
      work.canvas.width = cols;
      work.canvas.height = rows;
      work.clearRect(0, 0, cols, rows);
      paintRef.current(work, cols, rows, (performance.now() - start) / 1000);
      const image = work.getImageData(0, 0, cols, rows);
      dither(image.data, cols, rows, {
        threshold,
        colorMode,
        primary,
        secondary,
      });
      out.putImageData(image, 0, 0);
    };

    const resize = () => {
      const box = el.getBoundingClientRect();
      const nextCols = Math.max(1, Math.round(box.width / cell));
      const nextRows = Math.max(1, Math.round(box.height / cell));
      if (nextCols === cols && nextRows === rows) return;
      cols = nextCols;
      rows = nextRows;
      el.width = cols;
      el.height = rows;
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    let timer: number | undefined;
    if (animate) {
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') draw();
      }, 1000 / SHIMMER_FPS);
    }
    return () => {
      observer.disconnect();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [primaryColor, secondaryColor, gridSize, threshold, colorMode, animate]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={`block [image-rendering:pixelated] ${className}`}
    />
  );
}
