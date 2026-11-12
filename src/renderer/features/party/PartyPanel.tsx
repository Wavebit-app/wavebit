import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleArrowRight,
  CirclePlus,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  Link,
  ListMusic,
  Minus,
  Plus,
  RefreshCw,
  UserMinus,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { INVITE_PAGE, type PartyInvite } from '../../../shared/schemas/party';
import { nav } from '../../app/router';
import { setUi } from '../../app/ui';
import { Artwork } from '../../design/Artwork';
import { IconAction } from '../../design/IconAction';
import { SwitchRow } from '../../design/SwitchRow';
import { useSettings, useUpdateSettings } from '../../lib/queries';
import { SongArt } from '../downloads/SongArt';
import { IconButton } from '../player/controls';
import { partyPlayer, usePlayer, useStreaming } from '../player/player';
import { VideoSlot } from '../player/VideoSlot';
import { BACKDROP_MASK, useVideoStage, videoStage } from '../player/videoStage';
import { bannerFor } from './banners';
import { AvatarStack, inOrder, MemberAvatar, useLink } from './PartyBits';
import { controlsLocked, faultMessage, inviteLink } from './partyRules';
import { resyncParty } from './partySync';
import { useParty } from './store';

const api = () => window.wavebit.party;
const field =
  'h-10 min-w-0 rounded-md bg-sunken px-3 text-sm ring-1 ring-[var(--field-border)] outline-none focus:ring-2 focus:ring-accent';
/** The party server's own bounds for a party's size. */
const SIZE = { min: 2, max: 10 };

/** A tonal block, as Now playing's cards are. */
function Card({
  title,
  action,
  children,
}: {
  title?: string;
  /** An icon at the right of the heading. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="shrink-0 rounded-md bg-foreground/5 py-2 pr-2 pl-4">
      {title && (
        <div className="flex h-8 items-center">
          <h3 className="flex-1 text-sm font-semibold">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Back to Now playing, the drawer's name, and Close: as Queue and Lyrics have them. */
function Header({
  light = false,
  children,
}: {
  /** Over the video or cover, where the icons are white. */
  light?: boolean;
  children?: ReactNode;
}) {
  const tone = light ? 'text-white!' : '';
  return (
    <div
      className={`relative z-20 flex h-[60px] shrink-0 items-center gap-1 px-2 ${light ? 'text-white' : ''}`}
    >
      <IconButton
        label="Back to Now playing"
        onPress={() => setUi({ panel: 'now' })}
        size={32}
        className={tone}
      >
        <ArrowLeft size={18} />
      </IconButton>
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
        Listen together
      </h2>
      {children}
      <IconButton
        label="Close the drawer"
        onPress={() => setUi({ panel: null })}
        size={32}
        className={tone}
      >
        <X size={18} />
      </IconButton>
    </div>
  );
}

/**
 * The top of the drawer, as Now playing has it: the video, or the cover,
 * across the full width and fading into the column, with the song's name over
 * it. Shorter than Now playing's, so the party's code stays on screen. With
 * nothing playing there is only the header.
 */
function Top() {
  const track = usePlayer((s) => s.queue[s.index]);
  const streaming = useStreaming();
  const hidden = useVideoStage().hidden;
  const startedBy = useParty((s) => (s.code ? s.playback.startedByName : null));
  if (!track) return <Header />;
  return (
    <section
      aria-label="Playing in the party"
      className="relative h-[260px] shrink-0 overflow-hidden"
    >
      {streaming && !hidden ? (
        <VideoSlot backdrop="hero" className="absolute inset-0" />
      ) : (
        <div
          aria-hidden
          style={{ maskImage: BACKDROP_MASK }}
          className="absolute inset-0 overflow-hidden"
        >
          <Artwork
            src={track.artwork}
            className="size-full"
            rounded="rounded-none"
          />
        </div>
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[90px] bg-linear-to-b from-black/50 to-transparent"
      />
      <Header light>
        {streaming && (
          <IconButton
            label={hidden ? 'Show video' : 'Hide video'}
            onPress={() => videoStage.setHidden(!hidden)}
            size={32}
            className="text-white!"
          >
            {hidden ? <Eye size={18} /> : <EyeOff size={18} />}
          </IconButton>
        )}
      </Header>
      <div className="absolute inset-x-0 bottom-3 z-20 px-4">
        <p className="truncate text-[1.3333rem] leading-tight font-bold tracking-[-0.01em]">
          {track.title}
        </p>
        <p className="mt-0.5 truncate text-sm">
          {[track.artist, startedBy && `started by ${startedBy}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </section>
  );
}

/**
 * The banner: an illustration behind the party's code and its people, under
 * a dark wash so white text reads on any image (as the Lyrics card treats
 * its art). With the art switched off, or none shipped, it is a flat block.
 * `children` gets the class that turns an icon white over the art.
 */
function Banner({
  code,
  children,
}: {
  code: string | null;
  children: (tone: string) => ReactNode;
}) {
  const wanted = useSettings().data?.partyBanner ?? true;
  const art = wanted ? bannerFor(code) : null;
  return (
    <section
      className={`relative mx-4 flex min-h-[152px] shrink-0 flex-col overflow-hidden rounded-md ${art ? 'bg-neutral-800 text-white' : 'bg-accent-soft'}`}
    >
      {art && (
        <>
          <img
            src={art}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-cover"
          />
          <div aria-hidden className="absolute inset-0 bg-black/60" />
        </>
      )}
      <div className="relative flex flex-1 flex-col gap-1 pt-3 pr-2 pb-2 pl-4">
        {children(art ? 'text-white!' : '')}
      </div>
    </section>
  );
}

const Code = ({ children }: { children: string }) => (
  <span className="text-[1.8667rem] leading-tight font-bold tracking-[0.16em] select-text">
    {children}
  </span>
);

/** Copies, then shows a tick for a moment. */
function CopyAction({
  label,
  text,
  tone,
  children,
}: {
  label: string;
  text: string;
  tone: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const done = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(done);
  }, [copied]);
  return (
    <IconAction
      label={copied ? 'Copied' : label}
      size={32}
      className={tone}
      onPress={() =>
        void window.wavebit.app.copy(text).then(() => setCopied(true))
      }
    >
      {copied ? <Check size={18} aria-hidden /> : children}
    </IconAction>
  );
}

function Fault() {
  const error = useParty((s) => s.error);
  if (!error) return null;
  return (
    <p
      role="alert"
      className="shrink-0 rounded-md bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
    >
      {faultMessage(error)}
    </p>
  );
}

/** Who you join as: your account's name, or a name typed here. */
function You({ line = 'Your name in parties' }: { line?: string }) {
  const me = useParty((s) => s.me);
  const update = useUpdateSettings();
  const [name, setName] = useState('');
  if (me)
    return (
      <Card>
        <button
          type="button"
          onClick={() => nav.go({ name: 'settings', section: 'party' })}
          aria-label={`You join as ${me.name}. Change it in Settings`}
          className="flex min-h-11 w-full items-center gap-3 text-left"
        >
          <MemberAvatar
            member={{
              displayName: me.name,
              avatarUrl: me.imageUrl,
              isHost: false,
              connected: true,
            }}
            size={28}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{me.name}</span>
            <span className="truncate text-[0.8667rem] text-muted">{line}</span>
          </span>
          <ChevronRight
            size={18}
            className="mr-2 shrink-0 text-muted"
            aria-hidden
          />
        </button>
      </Card>
    );
  const save = () =>
    name.trim() && update.mutate({ partyName: name.trim().slice(0, 80) });
  return (
    <Card title="Your name in parties">
      <form
        className="flex items-center gap-1 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="What others see"
          aria-label="Your name in parties"
          className={`${field} flex-1`}
        />
        <IconAction label="Save name" size={40} onPress={() => void save()}>
          <Check size={22} className="text-accent" aria-hidden />
        </IconAction>
      </form>
    </Card>
  );
}

function StartOrJoin() {
  const busy = useParty((s) => s.busy);
  const named = useParty((s) => !!s.me);
  const autoplay = usePlayer((s) => s.autoplay);
  const [text, setText] = useState('');
  const join = () => text.trim() && void api().join(text.trim());
  return (
    <>
      <Banner code={null}>
        {() => (
          <>
            <p className="pr-2 text-[1.3333rem] leading-tight font-bold tracking-[-0.01em]">
              Hear the same music at the same moment.
            </p>
            <p className="pr-2 text-sm opacity-85">
              Up to five devices. Anyone in the party can play, pause and skip.
            </p>
          </>
        )}
      </Banner>
      <div className="flex flex-col gap-3 px-4">
        <Card>
          <div className="flex min-h-12 items-center gap-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">Start a party</span>
              <span className="text-[0.8667rem] text-muted">
                What you’re playing comes with you.
              </span>
            </span>
            <IconAction
              label="Start a party"
              size={40}
              isPending={busy}
              isDisabled={!named}
              onPress={() => void api().create(autoplay)}
            >
              <CirclePlus
                size={30}
                strokeWidth={1.6}
                className="text-accent"
                aria-hidden
              />
            </IconAction>
          </div>
        </Card>
        <Card title="Join a party">
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={600}
              placeholder="ABC123"
              spellCheck={false}
              autoComplete="off"
              aria-label="Party code or invite link"
              className={`${field} flex-1 font-semibold tracking-[0.12em] uppercase placeholder:font-normal`}
            />
            <IconAction
              label="Join"
              size={40}
              isDisabled={busy || !named || !text.trim()}
              onPress={join}
            >
              <CircleArrowRight
                size={30}
                strokeWidth={1.6}
                className="text-accent"
                aria-hidden
              />
            </IconAction>
          </form>
          <p className="pt-1.5 pr-2 pb-1 text-[0.8667rem] text-muted">
            The six-character code, or a pasted invite link.
          </p>
        </Card>
        <You />
        <Fault />
      </div>
    </>
  );
}

/**
 * An invite waiting for a press. A link always waits here: joining shows
 * your name and picture to the party and starts its music on this computer.
 */
function Invite({ invite }: { invite: PartyInvite }) {
  const named = useParty((s) => !!s.me);
  const preview = invite.preview;
  const people = preview?.members ?? [];
  const who =
    people.length > 0
      ? people
          .slice(0, 2)
          .map((m) => m.displayName)
          .join(' and ') + (people.length > 2 ? ' and the others' : '')
      : 'the people in it';
  return (
    <>
      <Banner code={invite.code}>
        {(tone) => (
          <>
            <Code>{invite.code}</Code>
            <p className="pr-2 text-sm opacity-85 tabular-nums">
              {preview
                ? `Invite · ${preview.hostName ? `${preview.hostName}’s party` : 'a party'} · ${people.length} of ${preview.maxMembers} listening`
                : `Invite on ${invite.host}`}
            </p>
            <div className="mt-auto flex items-center">
              <span className="flex-1">
                <AvatarStack
                  members={people.map((m) => ({ ...m, connected: true }))}
                  gap="ring-black/40"
                />
              </span>
              <IconAction
                label="Don’t join"
                size={36}
                className={tone}
                onPress={() => void api().declineInvite()}
              >
                <X size={20} aria-hidden />
              </IconAction>
              <IconAction
                label="Join this party"
                size={36}
                className={tone}
                isDisabled={!named || preview?.isFull}
                onPress={() => void api().acceptInvite()}
              >
                <Check size={22} aria-hidden />
              </IconAction>
            </div>
          </>
        )}
      </Banner>
      <div className="flex flex-col gap-3 px-4">
        {preview?.isFull ? (
          <p className="shrink-0 rounded-md bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
            That party is full.
          </p>
        ) : (
          <p className="shrink-0 rounded-md bg-foreground/5 px-4 py-3 text-sm text-muted">
            Joining shows {who} your name and picture, and starts their music
            here.
          </p>
        )}
        {invite.otherServer && (
          <p className="shrink-0 rounded-md bg-warning-soft px-4 py-3 text-sm">
            This invite is on{' '}
            <span className="font-semibold">{invite.host}</span>, not the server
            you use.
          </p>
        )}
        <You line="You join as" />
        <Fault />
      </div>
    </>
  );
}

/** The next two songs everyone will hear, and the way into the whole queue. */
function NextInParty() {
  usePlayer((s) => s.queue);
  usePlayer((s) => s.index);
  usePlayer((s) => s.upNext);
  const next = partyPlayer.upcoming().slice(0, 2);
  if (next.length === 0) return null;
  return (
    <Card
      title="Next in the party"
      action={
        <IconAction
          label="Open the party queue"
          size={32}
          onPress={() => setUi({ panel: 'queue' })}
        >
          <ListMusic size={18} aria-hidden />
        </IconAction>
      }
    >
      {next.map(({ track }, i) => (
        <div
          key={`${track.id}-${i}`}
          className="flex h-[52px] items-center gap-2.5"
        >
          <SongArt track={track} src={track.artwork} size={40} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{track.title}</span>
            <span className="truncate text-[0.8667rem] text-muted">
              {track.artist}
            </span>
          </span>
        </div>
      ))}
    </Card>
  );
}

function InParty({ code }: { code: string }) {
  const link = useLink();
  const server = useParty((s) => s.server);
  const members = useParty((s) => s.members);
  const max = useParty((s) => s.maxMembers);
  const you = useParty((s) => s.you);
  const hostOnly = useParty((s) => s.hostOnlyControl);
  const autoplay = useParty((s) => s.playback.autoplayEnabled);
  const locked = controlsLocked({ code, hostOnlyControl: hostOnly, you });
  const ordered = inOrder(members);
  const host = ordered.find((m) => m.isHost);
  const leave = () => void api().leave();
  const resize = (maxMembers: number) =>
    void api().control({ action: 'setMaxMembers', maxMembers });
  const status =
    link.text.endsWith('ms') && !link.warn
      ? `In sync · ${link.text}`
      : link.text;
  return (
    <>
      <Banner code={code}>
        {(tone) => (
          <>
            <Code>{code}</Code>
            <p className="flex items-center gap-1.5 pr-2 text-sm opacity-90 tabular-nums">
              <span aria-hidden className={`size-2 rounded-full ${link.dot}`} />
              {status} · {members.length} listening
            </p>
            <div className="mt-auto flex items-center">
              <span className="flex-1">
                <AvatarStack
                  members={ordered.slice(0, 5)}
                  gap={tone ? 'ring-black/40' : 'ring-accent-soft'}
                />
              </span>
              <CopyAction label="Copy code" text={code} tone={tone}>
                <Copy size={18} aria-hidden />
              </CopyAction>
              <CopyAction
                label="Copy invite link"
                text={inviteLink(code, server, INVITE_PAGE)}
                tone={tone}
              >
                <Link size={18} aria-hidden />
              </CopyAction>
              <IconAction
                label="Resync"
                size={32}
                className={tone}
                onPress={resyncParty}
              >
                <RefreshCw size={18} aria-hidden />
              </IconAction>
              <IconAction
                label="Leave party"
                size={32}
                className={tone || 'text-danger!'}
                onPress={leave}
              >
                <DoorOpen size={18} aria-hidden />
              </IconAction>
            </div>
          </>
        )}
      </Banner>
      <div className="flex flex-col gap-3 px-4">
        {locked && (
          <section className="flex shrink-0 items-center gap-2 rounded-md bg-warning-soft py-2 pr-2 pl-4 text-sm">
            <p className="flex-1 py-1">
              {host?.displayName ?? 'The host'} controls the music in this
              party. You can pause your own device. To play something else,
              leave.
            </p>
            <IconAction label="Leave party" size={36} onPress={leave}>
              <DoorOpen size={20} className="text-danger" aria-hidden />
            </IconAction>
          </section>
        )}
        <Card title={`Listening · ${members.length} of ${max}`}>
          <ul>
            {ordered.map((m) => (
              <li key={m.memberId} className="flex min-h-12 items-center gap-3">
                <MemberAvatar member={m} size={28} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {m.displayName}
                    {m.memberId === you?.memberId && (
                      <span className="font-normal text-muted"> (you)</span>
                    )}
                  </span>
                  {(m.isHost || !m.connected) && (
                    <span className="text-[0.8667rem] text-muted">
                      {[m.isHost && 'Host', !m.connected && 'Reconnecting']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </span>
                {you?.isHost && m.memberId !== you.memberId ? (
                  <IconAction
                    label={`Remove ${m.displayName} from the party`}
                    size={32}
                    onPress={() =>
                      void api().control({
                        action: 'kick',
                        memberId: m.memberId,
                      })
                    }
                  >
                    <UserMinus size={16} className="text-muted" aria-hidden />
                  </IconAction>
                ) : (
                  <span className="w-8 shrink-0" />
                )}
              </li>
            ))}
          </ul>
        </Card>
        {!locked && (
          <section
            aria-label="Party"
            className="shrink-0 overflow-hidden rounded-md bg-foreground/5"
          >
            {you?.isHost && (
              <SwitchRow
                flush
                label="Only I control the music"
                description="Others listen but can’t play, pause, skip or change the queue."
                isSelected={hostOnly}
                onChange={(enabled) =>
                  void api().control({ action: 'setHostOnlyControl', enabled })
                }
              />
            )}
            <SwitchRow
              flush
              label="AutoPlay"
              description="Similar songs for everyone when the queue runs out."
              isSelected={autoplay}
              onChange={(enabled) =>
                void api().control({ action: 'setAutoplay', enabled })
              }
            />
            {you?.isHost && (
              <div className="flex min-h-16 items-center gap-2 pr-2 pl-4">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium">Party size</span>
                  <span className="text-sm text-muted">
                    Devices that can join.
                  </span>
                </span>
                <IconAction
                  label="One fewer"
                  size={32}
                  isDisabled={max <= Math.max(SIZE.min, members.length)}
                  onPress={() => resize(max - 1)}
                >
                  <Minus size={18} aria-hidden />
                </IconAction>
                <span className="w-6 text-center font-semibold tabular-nums">
                  {max}
                </span>
                <IconAction
                  label="One more"
                  size={32}
                  isDisabled={max >= SIZE.max}
                  onPress={() => resize(max + 1)}
                >
                  <Plus size={18} aria-hidden />
                </IconAction>
              </div>
            )}
          </section>
        )}
        <NextInParty />
        <Fault />
      </div>
    </>
  );
}

/**
 * DESIGN.md › Listen together: a face of the right-hand column, built like
 * Now playing. The video or cover across the top, the banner with the
 * party's code and people under it, then cards: who is listening, the
 * party's switches and what plays next. Before a party it is where one is
 * started or joined. Actions are bare icons.
 */
export function PartyPanel({
  className = 'w-[var(--drawer-width,360px)] rounded-panel bg-surface',
}: {
  className?: string;
}) {
  const code = useParty((s) => s.code);
  const invite = useParty((s) => s.invite);
  return (
    <aside
      aria-label="Listen together"
      className={`flex ${className} shrink-0 flex-col overflow-hidden`}
    >
      <div data-video-scroll className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 pb-4">
          <Top />
          {invite ? (
            <Invite invite={invite} />
          ) : code ? (
            <InParty code={code} />
          ) : (
            <StartOrJoin />
          )}
        </div>
      </div>
    </aside>
  );
}
