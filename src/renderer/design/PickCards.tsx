import { AudioWaveform, Music } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The tall cards of Home's Top Picks and Library's listening row: 3:4, 12px
 * corners and one caption at the foot, over drawn art, a cover or a photo
 * (DESIGN.md › Home › Top Picks).
 */
const SHAPE =
  'relative block aspect-[3/4] w-full overflow-hidden rounded-[12px] text-left';
const CARD = `${SHAPE} text-white`;

/** The line above the title on a picture, which brings no colour of its own. */
const PHOTO_EYEBROW = 'rgb(255 255 255 / 0.75)';

/** Darkens the foot of a drawn card: white on these colours alone misses AA. */
const SCRIM =
  'absolute inset-0 bg-linear-to-b from-transparent from-35% to-black/70';

interface CardText {
  eyebrow: string;
  title: string;
  line: string;
}

function Caption({
  eyebrow,
  color,
  title,
  line,
  flat = false,
}: CardText & {
  color: string;
  /** On the flat placeholder: ordinary text colours instead of white. */
  flat?: boolean;
}) {
  return (
    <span className="absolute inset-x-4 bottom-4 flex flex-col">
      <span className="truncate text-[0.8667rem] leading-4" style={{ color }}>
        {eyebrow}
      </span>
      <span className="line-clamp-2 text-[1.1333rem] leading-[1.3] font-semibold">
        {title}
      </span>
      <span
        className={`line-clamp-2 text-[0.8667rem] leading-4 ${flat ? 'text-muted' : 'text-white/85'}`}
      >
        {line}
      </span>
    </span>
  );
}

/** A release or artist with no picture: a flat `sunken` card and a plain note. */
function EmptyPick({
  eyebrow,
  title,
  line,
  onPress,
}: CardText & { onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`${SHAPE} bg-sunken text-foreground`}
    >
      <span className="absolute inset-x-0 top-[28%] flex justify-center text-muted">
        <Music size={40} strokeWidth={1.5} aria-hidden />
      </span>
      <Caption
        flat
        eyebrow={eyebrow}
        color="var(--muted)"
        title={title}
        line={line}
      />
    </button>
  );
}

/**
 * Drawn art under the mark and the scrim. `children` sit over the art, and
 * with no `onPress` the card is only something to read.
 */
export function DrawnCard({
  art,
  eyebrow,
  color,
  title,
  line,
  onPress,
  children,
}: CardText & {
  art: ReactNode;
  /** The line above the title, tinted to go with the art. */
  color: string;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const body = (
    <>
      {art}
      <span aria-hidden className={SCRIM} />
      <AudioWaveform
        aria-hidden
        size={18}
        strokeWidth={2.2}
        className="absolute top-3 right-3"
      />
      {children}
      <Caption eyebrow={eyebrow} color={color} title={title} line={line} />
    </>
  );
  return onPress ? (
    <button type="button" onClick={onPress} className={CARD}>
      {body}
    </button>
  ) : (
    <div className={CARD}>{body}</div>
  );
}

/**
 * A release: the cover whole at the top, its lower edge fading into a blurred
 * copy of itself behind the caption.
 */
export function ReleaseCard({
  art,
  eyebrow,
  title,
  line,
  onPress,
}: CardText & { art: string | null; onPress: () => void }) {
  if (!art)
    return (
      <EmptyPick
        eyebrow={eyebrow}
        title={title}
        line={line}
        onPress={onPress}
      />
    );
  return (
    <button type="button" onClick={onPress} className={`${CARD} bg-black`}>
      <img
        src={art}
        alt=""
        draggable={false}
        loading="lazy"
        className="art-blur absolute inset-x-0 bottom-0 h-[42%] w-full scale-125 object-cover blur-2xl"
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-linear-to-b from-black/10 from-60% to-black/50"
      />
      <img
        src={art}
        alt=""
        draggable={false}
        loading="lazy"
        className="absolute inset-x-0 top-0 aspect-square w-full object-cover [mask-image:linear-gradient(black_78%,transparent)]"
      />
      <Caption
        eyebrow={eyebrow}
        color={PHOTO_EYEBROW}
        title={title}
        line={line}
      />
    </button>
  );
}

/** An artist: the picture full bleed, the caption on its own darkened foot. */
export function ArtistCard({
  art,
  name,
  eyebrow,
  line,
  onPress,
}: Omit<CardText, 'title'> & {
  art: string | null;
  name: string;
  onPress: () => void;
}) {
  if (!art)
    return (
      <EmptyPick eyebrow={eyebrow} title={name} line={line} onPress={onPress} />
    );
  return (
    <button type="button" onClick={onPress} className={`${CARD} bg-black`}>
      <img
        src={art}
        alt=""
        draggable={false}
        loading="lazy"
        className="absolute inset-0 size-full object-cover"
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(transparent_45%,rgb(0_0_0/0.45)_72%,rgb(0_0_0/0.82))]"
      />
      <Caption
        eyebrow={eyebrow}
        color={PHOTO_EYEBROW}
        title={name}
        line={line}
      />
    </button>
  );
}
