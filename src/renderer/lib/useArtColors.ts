import { useEffect, useState } from 'react';
import { pickColors, type Rgb } from './artPalette';
import { cachedArt } from './format';

const SAMPLE_SIZE = 32;
const known = new Map<string, Rgb[] | null>();

function sample(url: string): Promise<Rgb[] | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onerror = () => resolve(null);
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SAMPLE_SIZE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const colors = pickColors(data);
        resolve(colors.length > 0 ? colors : null);
      } catch {
        resolve(null);
      }
    };
    image.src = url;
  });
}

/** A cover's main colours, or null until they are read or if they can't be. */
export function useArtColors(src: string | null | undefined): Rgb[] | null {
  const url = src ? cachedArt(src) : null;
  const [colors, setColors] = useState<Rgb[] | null>(null);

  useEffect(() => {
    if (!url) {
      setColors(null);
      return;
    }
    if (known.has(url)) {
      setColors(known.get(url)!);
      return;
    }
    let current = true;
    void sample(url).then((found) => {
      known.set(url, found);
      if (current) setColors(found);
    });
    return () => {
      current = false;
    };
  }, [url]);

  return colors;
}
