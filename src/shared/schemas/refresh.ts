import { z } from 'zod';

/** Which remote caches a pull on the current page clears. */
export const RefreshSchema = z
  .object({ scope: z.enum(['home', 'explore', 'library', 'page']) })
  .strict();

export type RefreshScope = z.infer<typeof RefreshSchema>['scope'];
