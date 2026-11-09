/**
 * YouTube's official embedded player, driven through its documented
 * postMessage interface (the IFrame Player API's wire format), so no YouTube
 * script runs in wavebit's own page. One iframe for the whole app, created
 * once inside the stage (YouTubeStage.tsx) and never moved, since moving an
 * iframe reloads it.
 */

const ORIGIN = 'https://www.youtube-nocookie.com';

/** YouTube's player states. */
const ENDED = 0;
const PLAYING = 1;
const BUFFERING = 3;

export interface EmbedEvents {
  playing(playing: boolean): void;
  time(position: number, duration: number): void;
  ended(): void;
  /** The channel behind the playing video, as YouTube's player reports it. */
  author(videoId: string, name: string): void;
  /** 2 bad id, 5 player error, 100 removed, 101/150 embedding not allowed, 153 config. */
  error(code: number): void;
}

let host: HTMLElement | null = null;
let frame: HTMLIFrameElement | null = null;
let ready = false;
let pending: { func: string; args: unknown[] }[] = [];
let videoId: string | null = null;
let handshake: ReturnType<typeof setInterval> | undefined;
let events: EmbedEvents | null = null;

function post(func: string, args: unknown[] = []): void {
  if (!frame?.contentWindow || !ready) {
    pending.push({ func, args });
    return;
  }
  frame.contentWindow.postMessage(
    JSON.stringify({ event: 'command', func, args }),
    ORIGIN,
  );
}

/** Asks the player to start reporting, until it answers (the API's own "listening" handshake). */
function listen(): void {
  clearInterval(handshake);
  let tries = 0;
  handshake = setInterval(() => {
    if (ready || !frame?.contentWindow || ++tries > 60) {
      clearInterval(handshake);
      return;
    }
    frame.contentWindow.postMessage(
      JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
      ORIGIN,
    );
  }, 250);
}

function create(id: string, start: number, autoplay: boolean): void {
  if (!host) return;
  // BitChord shows a bare picture and drives playback from its own controls;
  // the embed's documented parameters get as close: no YouTube controls,
  // keyboard, fullscreen button, annotations or captions by default.
  const params = new URLSearchParams({
    enablejsapi: '1',
    autoplay: autoplay ? '1' : '0',
    controls: '0',
    disablekb: '1',
    fs: '0',
    iv_load_policy: '3',
    cc_load_policy: '0',
    playsinline: '1',
    rel: '0',
    start: String(Math.floor(start)),
    origin: location.origin,
  });
  frame = document.createElement('iframe');
  frame.title = 'YouTube video player';
  frame.src = `${ORIGIN}/embed/${id}?${params}`;
  frame.allow = 'autoplay; encrypted-media; picture-in-picture';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.setAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-presentation allow-popups',
  );
  frame.className = 'size-full border-0';
  frame.addEventListener('load', listen);
  ready = false;
  pending = [];
  host.replaceChildren(frame);
}

window.addEventListener('message', (e: MessageEvent) => {
  if (e.origin !== ORIGIN || !frame || e.source !== frame.contentWindow) return;
  let data: { event?: string; info?: unknown };
  try {
    data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
  } catch {
    return;
  }
  if (data.event === 'onReady' || (data.event === 'infoDelivery' && !ready)) {
    ready = true;
    clearInterval(handshake);
    // State changes and errors are only sent to listeners that ask, as the API's own script does.
    for (const name of ['onStateChange', 'onError'])
      frame.contentWindow?.postMessage(
        JSON.stringify({
          event: 'command',
          func: 'addEventListener',
          args: [name],
        }),
        ORIGIN,
      );
    const queued = pending;
    pending = [];
    for (const c of queued) post(c.func, c.args);
  }
  if (data.event === 'onStateChange' && typeof data.info === 'number') {
    if (data.info === ENDED) events?.ended();
    else events?.playing(data.info === PLAYING || data.info === BUFFERING);
  }
  if (data.event === 'onError' && typeof data.info === 'number')
    events?.error(data.info);
  if (
    data.event === 'infoDelivery' &&
    data.info &&
    typeof data.info === 'object'
  ) {
    const info = data.info as {
      currentTime?: number;
      duration?: number;
      playerState?: number;
      videoData?: { video_id?: unknown; author?: unknown };
    };
    const { video_id: videoId, author } = info.videoData ?? {};
    if (typeof videoId === 'string' && typeof author === 'string' && author)
      events?.author(videoId, author);
    if (typeof info.currentTime === 'number')
      events?.time(info.currentTime, info.duration ?? 0);
    // State changes also arrive here, often without a separate onStateChange.
    if (typeof info.playerState === 'number') {
      if (info.playerState === ENDED) events?.ended();
      else if (info.playerState >= PLAYING)
        events?.playing(
          info.playerState === PLAYING || info.playerState === BUFFERING,
        );
    }
  }
});

export const youtubeEmbed = {
  /** The stage mounts once; until then nothing can play. */
  attach(element: HTMLElement | null): void {
    host = element;
    if (host && frame && !host.contains(frame)) host.replaceChildren(frame);
  },
  on(handlers: EmbedEvents): void {
    events = handlers;
  },
  current(): string | null {
    return videoId;
  },
  load(id: string, start = 0, autoplay = true): void {
    if (!frame) {
      videoId = id;
      create(id, start, autoplay);
      return;
    }
    if (id === videoId) {
      post('seekTo', [start, true]);
      if (autoplay) post('playVideo');
      return;
    }
    videoId = id;
    post(autoplay ? 'loadVideoById' : 'cueVideoById', [
      { videoId: id, startSeconds: Math.floor(start) },
    ]);
  },
  play: () => post('playVideo'),
  pause: () => post('pauseVideo'),
  seek: (seconds: number) => post('seekTo', [seconds, true]),
  /** 0–1, as the rest of the player counts it. */
  setVolume: (volume: number) => post('setVolume', [Math.round(volume * 100)]),
  setSpeed: (speed: number) => post('setPlaybackRate', [speed]),
  stop(): void {
    post('stopVideo');
  },
};
