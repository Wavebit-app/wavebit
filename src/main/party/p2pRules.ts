import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Host on this device: what the helper (`server/cmd/wavebit-p2p`) says, the
 * safety number two people compare, and the link a host shares. Pure, so it
 * can be tested without a helper.
 */

const PEER = /^12D3KooW[1-9A-HJ-NP-Za-km-z]{38,52}$/;

/**
 * An address the host's helper says it can be reached at. The Rust module
 * checks every address a link carries again (`clean_host_addr`); this only
 * keeps the helper's own output to that shape.
 */
const HOST_ADDR =
  /^\/(ip4\/(\d{1,3}\.){3}\d{1,3}|ip6\/[0-9a-f:]{2,39})\/(tcp\/\d{4,5}|udp\/\d{4,5}\/quic-v1)$/;
const HostAddrs = z.array(z.string().max(80).regex(HOST_ADDR)).max(6);

/** One line from the helper. It is read as untrusted, like a server's frame. */
export const HelperEventSchema = z.discriminatedUnion('event', [
  z
    .object({
      event: z.literal('ready'),
      port: z.number().int().min(1024).max(65_535),
      peerId: z.string().regex(PEER),
      addrs: HostAddrs.default([]),
      public: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      event: z.literal('addrs'),
      addrs: HostAddrs,
      public: z.boolean(),
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
 * helper wants; a relay only when it isn't the one wavebit uses anyway; and
 * the addresses this computer can be reached at directly, when it has any.
 */
export function p2pLink(
  code: string,
  peerId: string,
  key: string,
  relay: string | null,
  defaultRelay: string | null,
  addrs: readonly string[] = [],
): string {
  const via =
    relay && relay !== defaultRelay
      ? `&relay=${encodeURIComponent(relay)}`
      : '';
  const at = addrs.length
    ? `&at=${addrs.map(encodeURIComponent).join(',')}`
    : '';
  return `wavebit://party/${code}?peer=${peerId}&key=${key}${via}${at}`;
}

/**
 * Who can reach a party hosted on this computer: anyone (a relay, or a port
 * the router opened), people on the same network only, or nobody yet.
 */
export type HostReach = 'anyone' | 'network' | 'none';

export function hostReach(
  relay: string | null,
  addrs: readonly string[],
  isPublic: boolean,
): HostReach {
  if (relay || isPublic) return 'anyone';
  return addrs.length ? 'network' : 'none';
}
