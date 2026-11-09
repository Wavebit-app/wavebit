/** DESIGN.md › Empty states: line art in `faint` with one element in `accent`. */
export function EmptyArt({
  kind,
  size = 120,
}: {
  kind: 'folder' | 'playlist' | 'search';
  size?: number;
}) {
  const faint = 'var(--faint)';
  const accent = 'var(--accent)';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {kind === 'folder' && (
        <>
          <path
            d="M14 34a8 8 0 0 1 8-8h22l10 12h44a8 8 0 0 1 8 8v46a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8z"
            stroke={faint}
            strokeWidth={2.5}
          />
          <path d="M14 50h92" stroke={faint} strokeWidth={2.5} />
          <path d="M66 62v22M66 62l12-4v8" stroke={accent} strokeWidth={3} />
          <circle cx={60} cy={85} r={6} stroke={accent} strokeWidth={3} />
        </>
      )}
      {kind === 'playlist' && (
        <>
          <path
            d="M18 34h62M18 56h48M18 78h40M18 100h30"
            stroke={faint}
            strokeWidth={3}
          />
          <path d="M98 88V40l-16 6" stroke={accent} strokeWidth={3.5} />
          <circle cx={88} cy={90} r={10} stroke={accent} strokeWidth={3.5} />
        </>
      )}
      {kind === 'search' && (
        <>
          <circle cx={52} cy={52} r={33} stroke={faint} strokeWidth={3} />
          <path d="M77 77l23 23" stroke={faint} strokeWidth={3} />
          <path
            d="M44 44a8 8 0 1 1 10 8c-1.5.8-1.6 2.4-1.6 4"
            stroke={accent}
            strokeWidth={3.5}
          />
          <path d="M52.5 66h.01" stroke={accent} strokeWidth={4.5} />
        </>
      )}
    </svg>
  );
}
