import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { newSecret, readHelperLine } from './p2pRules';

/**
 * The helper behind Host on this device (`server/cmd/wavebit-p2p`), shipped
 * in `tools/`. Its path is fixed, its arguments are none, and its secrets go
 * over stdin, never on the command line. It exits when wavebit closes its
 * stdin, so it can't outlive the app.
 */

export interface Helper {
  mode: 'host' | 'join';
  /** The bridge on 127.0.0.1 the party client connects to. */
  origin: string;
  /** Its secret: never in settings, a log or anything the page is told. */
  bridgeKey: string;
  /** This computer's identity on the network. */
  peerId: string;
  /** The host's identity: this computer's, or the one the invite named. */
  hostPeer: string;
  partyKey: string;
  relay: string;
  links: { direct: number; relayed: number };
  stop(): void;
}

/** Beside the download tools: in Resources when packaged, the project's `tools/` in dev. */
export function helperPath(): string | null {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'tools')
    : path.join(app.getAppPath(), 'tools');
  const file = path.join(
    dir,
    process.platform === 'win32' ? 'wavebit-p2p.exe' : 'wavebit-p2p',
  );
  return existsSync(file) ? file : null;
}

const READY_TIMEOUT_MS = 45_000;

/**
 * Starts the helper and waits until its bridge answers. Rejects with a fault
 * code: `helper_missing`, `relay_unreachable`, `host_unreachable`,
 * `p2p_failed`.
 */
export function startHelper(options: {
  mode: 'host' | 'join';
  partyKey: string;
  relay: string;
  direct: boolean;
  hostPeer?: string;
  onLinks: (links: { direct: number; relayed: number }) => void;
  onExit: () => void;
}): Promise<Helper> {
  const file = helperPath();
  if (!file) return Promise.reject(new Error('helper_missing'));
  const bridgeKey = newSecret(32);
  // Nothing of wavebit's own environment: the helper needs none of it.
  const env: NodeJS.ProcessEnv =
    process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {};
  let child: ChildProcess;
  try {
    child = spawn(file, [], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
      env,
    });
  } catch {
    return Promise.reject(new Error('p2p_failed'));
  }
  child.stdin?.write(
    `${JSON.stringify({
      mode: options.mode,
      bridgeKey,
      partyKey: options.partyKey,
      hostPeer: options.hostPeer ?? '',
      relay: options.relay,
      direct: options.direct,
    })}\n`,
  );
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    child.stdin?.end();
    // Closing stdin is enough; this is for one that doesn't listen.
    setTimeout(() => child.kill(), 2_000).unref();
  };

  return new Promise<Helper>((resolve, reject) => {
    let helper: Helper | null = null;
    const timer = setTimeout(() => {
      stop();
      reject(new Error('p2p_failed'));
    }, READY_TIMEOUT_MS);
    const lines = createInterface({ input: child.stdout! });
    lines.on('line', (line) => {
      const event = readHelperLine(line);
      if (!event) return;
      if (event.event === 'ready' && !helper) {
        clearTimeout(timer);
        helper = {
          mode: options.mode,
          origin: `http://127.0.0.1:${event.port}`,
          bridgeKey,
          peerId: event.peerId,
          hostPeer: options.hostPeer ?? event.peerId,
          partyKey: options.partyKey,
          relay: options.relay,
          links: { direct: 0, relayed: 0 },
          stop,
        };
        resolve(helper);
      } else if (event.event === 'links' && helper) {
        helper.links = { direct: event.direct, relayed: event.relayed };
        options.onLinks(helper.links);
      } else if (event.event === 'error' && !helper) {
        clearTimeout(timer);
        const known = ['relay_unreachable', 'host_unreachable', 'bad_relay'];
        reject(
          new Error(known.includes(event.code) ? event.code : 'p2p_failed'),
        );
      }
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('p2p_failed'));
    });
    child.on('exit', () => {
      clearTimeout(timer);
      stopped = true;
      if (helper) options.onExit();
      else reject(new Error('p2p_failed'));
    });
  });
}
