import type { ReactNode } from 'react';

/** One title per page, an optional muted line, and actions on the right. */
export function PageHeader({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-page font-semibold tracking-[-0.01em]">{title}</h1>
        {meta && (
          <span className="text-sm text-muted tabular-nums">{meta}</span>
        )}
      </div>
      {children}
    </header>
  );
}
