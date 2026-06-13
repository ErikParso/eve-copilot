import { useMemo, type ReactNode } from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
} from '@mui/material';
import { formatDuration, formatIsk, formatNumber, formatVolume } from '@/utils/format';
import type { CourierRow } from '../types';
import { LocationCell } from './LocationCell';
import { AttractivityCell } from './AttractivityCell';
import { useTableSort, type SortValueGetter } from './useTableSort';

interface Column {
  id: string;
  label: string;
  align: 'left' | 'right' | 'center';
  tooltip?: string;
  render: (row: CourierRow) => ReactNode;
  sortValue: SortValueGetter<CourierRow>;
}

const jumps = (value: number | null): ReactNode => (value === null ? '—' : formatNumber(value, 0));

interface ContractsTableProps {
  rows: CourierRow[];
  /** Whether to show the "jumps from current station" column. */
  showCurrentJumps: boolean;
}

export function ContractsTable({ rows, showCurrentJumps }: ContractsTableProps) {
  const columns = useMemo<Column[]>(() => {
    const all: (Column | false)[] = [
      {
        id: 'pickup',
        label: 'Pickup',
        align: 'left',
        render: (r) => <LocationCell endpoint={r.pickup} />,
        sortValue: (r) => r.pickup.name,
      },
      {
        id: 'dropoff',
        label: 'Dropoff',
        align: 'left',
        render: (r) => <LocationCell endpoint={r.dropoff} />,
        sortValue: (r) => r.dropoff.name,
      },
      {
        id: 'volume',
        label: 'Cargo',
        align: 'right',
        render: (r) => formatVolume(r.volume),
        sortValue: (r) => r.volume,
      },
      {
        id: 'reward',
        label: 'Income',
        align: 'right',
        render: (r) => formatIsk(r.reward),
        sortValue: (r) => r.reward,
      },
      showCurrentJumps && {
        id: 'jumpsFromCurrent',
        label: 'Jumps to pickup',
        align: 'right',
        tooltip: 'Jumps from your current station to the pickup location.',
        render: (r) => jumps(r.jumpsFromCurrent),
        sortValue: (r) => r.jumpsFromCurrent,
      },
      {
        id: 'jumpsToDropoff',
        label: 'Jumps pickup→dropoff',
        align: 'right',
        tooltip: 'Jumps from pickup to dropoff (the delivery leg).',
        render: (r) => jumps(r.jumpsToDropoff),
        sortValue: (r) => r.jumpsToDropoff,
      },
      {
        id: 'incomePerJump',
        label: 'Income / jump',
        align: 'right',
        tooltip: showCurrentJumps
          ? 'Income divided by total jumps (approach + delivery).'
          : 'Income divided by delivery jumps.',
        render: (r) => (r.incomePerJump === null ? '—' : formatIsk(r.incomePerJump)),
        sortValue: (r) => r.incomePerJump,
      },
      {
        id: 'activeDuration',
        label: 'Active for',
        align: 'right',
        tooltip: 'Total time the contract is listed (issued → expiry).',
        render: (r) => formatDuration(r.activeDurationSeconds),
        sortValue: (r) => r.activeDurationSeconds,
      },
      {
        id: 'remaining',
        label: 'Time left',
        align: 'right',
        tooltip: 'Time until the contract expires.',
        render: (r) => formatDuration(r.remainingSeconds),
        sortValue: (r) => r.remainingSeconds,
      },
      {
        id: 'attractivity',
        label: 'Attractivity',
        align: 'center',
        tooltip: 'Index 0–100 from the selected method. Higher is better.',
        render: (r) => <AttractivityCell score={r.attractivity} />,
        sortValue: (r) => r.attractivity,
      },
    ];
    return all.filter((c): c is Column => c !== false);
  }, [showCurrentJumps]);

  const getters = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.id, c.sortValue])),
    [columns],
  );

  const { sort, cycleSort, sortedRows } = useTableSort(rows, getters);

  return (
    <TableContainer component={Paper} elevation={2}>
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow>
            {columns.map((col) => {
              const active = sort?.columnId === col.id;
              const header = (
                <TableSortLabel
                  active={active}
                  direction={active ? sort!.direction : 'desc'}
                  onClick={() => cycleSort(col.id)}
                >
                  {col.label}
                </TableSortLabel>
              );
              return (
                <TableCell
                  key={col.id}
                  align={col.align}
                  sortDirection={active ? sort!.direction : false}
                  sx={{ fontWeight: 700, whiteSpace: 'nowrap', bgcolor: 'background.paper' }}
                >
                  {col.tooltip ? (
                    <Tooltip title={col.tooltip} arrow>
                      <span>{header}</span>
                    </Tooltip>
                  ) : (
                    header
                  )}
                </TableCell>
              );
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedRows.map((row) => (
            <TableRow key={row.id} hover>
              {columns.map((col) => (
                <TableCell key={col.id} align={col.align} sx={{ whiteSpace: 'nowrap' }}>
                  {col.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
