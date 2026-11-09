import { tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { AppInfo } from '../../../shared/ipc/api';

interface Row {
  component: string;
  version: string;
}

const features = tableFeatures({});

const columns: Array<ColumnDef<typeof features, Row>> = [
  { accessorKey: 'component', header: 'Component' },
  {
    accessorKey: 'version',
    header: 'Version',
    cell: (info) => <code>{info.getValue<string>()}</code>,
  },
];

export function RuntimeTable({ info }: { info: AppInfo }) {
  const data = useMemo<Row[]>(
    () => [
      { component: 'wavebit', version: info.version },
      { component: 'Rust native module', version: info.nativeVersion },
      { component: 'Electron', version: info.electron },
      { component: 'Chromium', version: info.chrome },
      { component: 'Node.js', version: info.node },
      { component: 'Platform', version: `${info.platform} ${info.arch}` },
    ],
    [info],
  );
  const table = useTable({ features, columns, data });

  return (
    <table className="w-full text-left text-sm">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th
                key={header.id}
                className="py-1.5 pr-4 text-sm font-medium text-muted"
              >
                {header.isPlaceholder ? null : (
                  <table.FlexRender header={header} />
                )}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getAllCells().map((cell) => (
              <td key={cell.id} className="py-1.5 pr-4">
                <table.FlexRender cell={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
