import { useQuery } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { date } from '../lib/format';
import { Artwork } from './Artwork';
import { SideOrBottomSheet } from './Sheet';

export interface Details {
  /** What the sheet is about: "Song details". */
  heading: string;
  title: string;
  subtitle?: string | null;
  art?: string | null;
  round?: boolean;
  /** Label and value; a row with no value isn't drawn. */
  rows: [string, string | number | null | undefined][];
  /** A library file, whose format and size are read from the disk. */
  fileId?: string;
}

let current: Details | null = null;
const listeners = new Set<() => void>();

export function showDetails(details: Details) {
  current = details;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function size(bytes: number) {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(1)} GB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** "Show details" from any context menu (DESIGN.md › Context menus). */
export function DetailsSheetHost() {
  const details = useSyncExternalStore(subscribe, () => current);
  // Closing keeps the contents, so they don't blank while the sheet slides away.
  const [closedFor, setClosedFor] = useState<Details | null>(null);
  const fileId = details?.fileId;
  const file = useQuery({
    queryKey: ['library', 'fileInfo', fileId],
    queryFn: () => window.wavebit.library.fileInfo(fileId!),
    enabled: !!fileId,
    staleTime: 0,
  }).data;
  if (!details) return null;
  const rows = [
    ...details.rows,
    ...(fileId && file
      ? ([
          ['Format', file.format],
          ['Size', size(file.sizeBytes)],
          ['Modified', date(file.modifiedMs / 1000)],
        ] as Details['rows'])
      : []),
  ].filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );
  return (
    <SideOrBottomSheet
      isOpen={closedFor !== details}
      onOpenChange={(isOpen) => {
        if (!isOpen) setClosedFor(details);
      }}
      title={details.heading}
    >
      <div className="flex flex-col pb-4">
        <Artwork
          src={details.art}
          size={120}
          rounded={details.round ? 'rounded-full' : 'rounded-md'}
        />
        <p className="mt-3.5 text-[1.0667rem] font-semibold">{details.title}</p>
        {details.subtitle && (
          <p className="text-sm text-muted">{details.subtitle}</p>
        )}
        <dl className="mt-4 grid grid-cols-[88px_minmax(0,1fr)] gap-y-2 text-[0.8667rem]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="m-0 break-words tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </SideOrBottomSheet>
  );
}
