import { AnimatePresence, motion } from 'motion/react';
import { PARTY_REACTIONS } from '../../../shared/schemas/party';
import { IconAction } from '../../design/IconAction';
import { useMotion } from '../../lib/useTheme';
import { FLOAT_MS, REACTIONS } from './reactionRules';
import { react, useReactions } from './reactionStore';
import { useParty } from './store';

const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/**
 * DESIGN.md › Listen together › Reactions: eight bare icons in a row under
 * the banner. Only on a server that passes reactions on (wavebit's own);
 * on BitChord's the row isn't there, since a press would go nowhere.
 */
export function ReactionBar() {
  const offered = useParty((s) => s.reactions);
  if (!offered) return null;
  return (
    <section
      aria-label="React"
      className="flex shrink-0 justify-between rounded-md bg-foreground/5 p-1"
    >
      {PARTY_REACTIONS.map((id) => (
        <IconAction
          key={id}
          label={`React with ${REACTIONS[id].name}`}
          size={36}
          onPress={() => react(id)}
        >
          <span
            aria-hidden
            className="text-[1.3333rem] leading-none"
            style={{ fontFamily: EMOJI_FONT }}
          >
            {REACTIONS[id].emoji}
          </span>
        </IconAction>
      ))}
    </section>
  );
}

/**
 * The reactions floating up over the banner, everyone's and yours. Each goes
 * once: at Full it rises and fades, at Reduced it only fades, at Off it just
 * appears and goes. Screen readers hear a line instead, at most every few
 * seconds.
 */
export function ReactionLayer() {
  const floats = useReactions((s) => s.floats);
  const said = useReactions((s) => s.said);
  const level = useMotion();
  const seconds = FLOAT_MS / 1000;
  const animate =
    level === 'full'
      ? { opacity: [0, 1, 1, 0], y: [0, -16, -40, -56] }
      : level === 'reduced'
        ? { opacity: [0, 1, 1, 0] }
        : { opacity: 1 };
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <AnimatePresence>
          {floats.map((f) => (
            <motion.span
              // A count added to it starts it again.
              key={`${f.key}-${f.count}`}
              className="absolute bottom-11 flex items-baseline gap-0.5 text-[1.7333rem] leading-none"
              style={{ left: `${f.lane}%`, fontFamily: EMOJI_FONT }}
              initial={{ opacity: 0, y: 0 }}
              animate={animate}
              exit={{ opacity: 0, transition: { duration: 0 } }}
              transition={
                level === 'off'
                  ? { duration: 0 }
                  : {
                      duration: seconds,
                      times: [0, 0.15, 0.7, 1],
                      ease: 'easeOut',
                    }
              }
            >
              {REACTIONS[f.reaction].emoji}
              {f.count > 1 && (
                <span className="text-xs font-bold text-white">×{f.count}</span>
              )}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </>
  );
}

/**
 * The badge on a listener's picture in the title bar while the drawer is
 * closed: their reaction, for a moment. On the +N pill it is the reaction of
 * whichever of the folded listeners sent one.
 */
export function ReactionBadge({ memberIds }: { memberIds: string[] }) {
  const badge = useReactions((s) =>
    memberIds.map((id) => s.badges[id]).find(Boolean),
  );
  const level = useMotion();
  return (
    <AnimatePresence>
      {badge && (
        <motion.span
          key={badge.key}
          aria-hidden
          className="pointer-events-none absolute -right-1.5 -bottom-1.5 z-20 grid size-[18px] place-items-center rounded-full bg-surface text-[0.7333rem] leading-none ring-2 ring-canvas"
          style={{ fontFamily: EMOJI_FONT }}
          initial={
            level === 'full' ? { scale: 0.4, opacity: 0 } : { opacity: 0 }
          }
          animate={{ scale: 1, opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: level === 'off' ? 0 : 0.15 }}
        >
          {REACTIONS[badge.reaction].emoji}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
