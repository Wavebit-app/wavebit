/** What's playing right now: three bars that move with the music, still when paused. */
export function PlayingBars({
  paused,
  className = 'text-accent',
}: {
  paused: boolean;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={paused ? 'Paused' : 'Playing'}
      data-paused={paused || undefined}
      className={`playing-bars shrink-0 ${className}`}
    >
      <i />
      <i />
      <i />
    </span>
  );
}
