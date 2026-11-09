import Store from 'electron-store';
import { z } from 'zod';

const BoundsSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(360).max(10_000),
  height: z.number().int().min(480).max(10_000),
  maximized: z.boolean(),
});
export type WindowBounds = z.infer<typeof BoundsSchema>;

const DEFAULT: WindowBounds = { width: 1280, height: 820, maximized: false };
let opened: Store<{ bounds: WindowBounds }> | null = null;
const store = () =>
  (opened ??= new Store<{ bounds: WindowBounds }>({
    name: 'window-state',
    defaults: { bounds: DEFAULT },
    clearInvalidConfig: true,
  }));

export function readBounds(): WindowBounds {
  const parsed = BoundsSchema.safeParse(store().get('bounds'));
  return parsed.success ? parsed.data : DEFAULT;
}

export function saveBounds(bounds: WindowBounds): void {
  store().set('bounds', bounds);
}
