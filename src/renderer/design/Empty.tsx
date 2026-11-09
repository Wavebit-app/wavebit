import { EmptyState } from '@heroui/react';
import type { ReactNode } from 'react';
import { EmptyArt } from './EmptyArt';

/** Exactly four parts: art, title, one sentence, one action. */
export function Empty({
  art,
  title,
  children,
  action,
  size = 120,
}: {
  art: 'folder' | 'playlist' | 'search';
  title: string;
  children: ReactNode;
  action?: ReactNode;
  size?: number;
}) {
  return (
    <EmptyState className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <EmptyArt kind={art} size={size} />
      <h2 className="mt-5 text-xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-[26rem] leading-relaxed text-muted">
        {children}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </EmptyState>
  );
}
