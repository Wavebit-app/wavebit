import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Host on this device: what the helper (`server/cmd/wavebit-p2p`) says, the
 * safety number two people compare, and the link a host shares. Pure, so it
 * can be tested without a helper.
 */

const PEER = /^12D3KooW[1-9A-HJ-NP-Za-km-z]{38,52}$/;

/** One line from the helper. It is read as untrusted, like a server's frame. */
export const HelperEventSchema = z.discriminatedUnion('event', [
  z
    .object({
      event: z.literal('ready'),
      port: z.number().int().min(1024).max(65_535),
      peerId: z.string().regex(PEER),
    })
    .strict(),
  z
    .object({
      event: z.literal('links'),
      direct: z.number().int().min(0).max(64),
      relayed: z.number().int().min(0).max(64),
    })
    .strict(),
  z
    .object({
      event: z.literal('error'),
      code: z.string().regex(/^[a-z_]{1,40}$/),
    })
    .strict(),
]);
export type HelperEvent = z.infer<typeof HelperEventSchema>;

/** A helper line, or null for anything that isn't one. */
export function readHelperLine(line: string): HelperEvent | null {
  if (line.length > 1_000) return null;
  try {
    const parsed = HelperEventSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A secret for the bridge or an invite: random, url-safe. */
export const newSecret = (bytes: number): string =>
  randomBytes(bytes).toString('base64url');

const SAFE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Eight characters from the host's identity, shown on the host's screen and
 * on the invite. When two people read out the same, the invite reached the
 * computer it says it did.
 */
export function safetyNumber(peerId: string): string {
  const digest = createHash('sha256')
    .update(`wavebit-party|${peerId}`)
    .digest();
  let out = '';
  for (let i = 0; i < 8; i++)
    out += SAFE_ALPHABET[(digest[i] ?? 0) % SAFE_ALPHABET.length];
  return `${out.slice(0, 4)} · ${out.slice(4)}`;
}

/**
 * The link a host shares. It names this computer and carries the key its
 * helper wants; a relay only when it isn't the one wavebit uses anyway.
 */
export function p2pLink(
  code: string,
  peerId: string,
  key: string,
  relay: string,
  defaultRelay: string | null,
): string {
  const via =
    relay !== defaultRelay ? `&relay=${encodeURIComponent(relay)}` : '';
  return `wavebit://party/${code}?peer=${peerId}&key=${key}${via}`;
}
