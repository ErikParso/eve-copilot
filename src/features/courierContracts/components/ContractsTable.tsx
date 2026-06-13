import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Tooltip,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { formatDuration, formatIsk, formatIskMillions, formatVolume } from '@/utils/format';
import type { CourierRow } from '../types';
import { LocationCell } from './LocationCell';
import { AttractivityCell } from './AttractivityCell';
import { DangerCell } from './DangerCell';
import { RouteCell } from './RouteCell';
import { useTableSort, type SortValueGetter } from './useTableSort';

interface Column {
  id: string;
  label: string;
  align: 'left' | 'right' | 'center';
  tooltip?: string;
  render: (row: CourierRow) => ReactNode;
  sortValue: SortValueGetter<CourierRow>;
  /** Extra styling for the body cells of this column. */
  cellSx?: SxProps<Theme>;
}

// The route column wraps so the square strip can flow under the jump count.
const ROUTE_CELL_SX: SxProps<Theme> = { whiteSpace: 'normal', verticalAlign: 'top', minWidth: 260 };

// Cap the pickup/dropoff columns; long station names truncate with ellipsis
// (the full name is available in each cell's tooltip).
const LOCATION_CELL_SX: SxProps<Theme> = { maxWidth: 190, overflow: 'hidden' };

interface ContractsTableProps {
  rows: CourierRow[];
  /** Whether to show the "jumps from current station" column. */
  showCurrentJumps: boolean;
}

export function ContractsTable({ rows, showCurrentJumps }: ContractsTableProps) {
  const columns = useMemo<Column[]>(() => {
    const all: (Column | false)[] = [
      {
        id: 'attractivity',
        label: 'Attractivity',
        align: 'center',
        tooltip: 'Index 0–100 from the selected method. Hover a value to see how it was calculated.',
        render: (r) => <AttractivityCell score={r.attractivity} steps={r.attractivitySteps} />,
        sortValue: (r) => r.attractivity,
      },
      {
        id: 'pickup',
        label: 'Pickup',
        align: 'left',
        render: (r) => <LocationCell endpoint={r.pickup} />,
        sortValue: (r) => r.pickup.name,
        cellSx: LOCATION_CELL_SX,
      },
      {
        id: 'dropoff',
        label: 'Dropoff',
        align: 'left',
        render: (r) => <LocationCell endpoint={r.dropoff} />,
        sortValue: (r) => r.dropoff.name,
        cellSx: LOCATION_CELL_SX,
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
        render: (r) => formatIskMillions(r.reward),
        sortValue: (r) => r.reward,
      },
      {
        id: 'route',
        label: 'Route',
        align: 'left',
        tooltip: showCurrentJumps
          ? 'Full journey: current station → pickup (↑) → dropoff (↓). Squares are systems, coloured by EVE security. Jumps shown as "approach + delivery".'
          : 'Delivery route pickup (↑) → dropoff (↓). Squares are systems, coloured by EVE security.',
        render: (r) => <RouteCell row={r} />,
        sortValue: (r) => r.totalJumps,
        cellSx: ROUTE_CELL_SX,
      },
      {
        id: 'danger',
        label: 'Danger',
        align: 'center',
        tooltip: 'Danger index 0–100 for the delivery route (low/null-sec + recent kills). Hover a value for the calculation.',
        render: (r) => <DangerCell score={r.danger} steps={r.dangerSteps} />,
        sortValue: (r) => r.danger,
      },
      {
        id: 'incomePerJump',
        label: 'ISK / jump',
        align: 'right',
        tooltip: showCurrentJumps
          ? 'Income divided by total journey jumps (to pickup + delivery).'
          : 'Income divided by the delivery jumps.',
        render: (r) => (r.incomePerJump === null ? '—' : formatIsk(r.incomePerJump)),
        sortValue: (r) => r.incomePerJump,
      },
      {
        id: 'activeDuration',
        label: 'Active',
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
    ];
    return all.filter((c): c is Column => c !== false);
  }, [showCurrentJumps]);

  const getters = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.id, c.sortValue])),
    [columns],
  );

  const { sort, cycleSort, sortedRows } = useTableSort(rows, getters, {
    columnId: 'attractivity',
    direction: 'desc',
  });

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Jump back to the first page whenever the result set or sort order changes.
  useEffect(() => {
    setPage(0);
  }, [rows, sort]);

  const pagedRows = useMemo(
    () => sortedRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [sortedRows, page, rowsPerPage],
  );

  return (
    <Paper elevation={2}>
      <TableContainer>
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
                  sx={{
                    fontWeight: 700,
                    fontSize: '0.7rem',
                    lineHeight: 1.15,
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                    color: 'text.secondary',
                    verticalAlign: 'bottom',
                    whiteSpace: 'nowrap',
                    py: 0.75,
                    px: 1,
                    bgcolor: 'background.paper',
                  }}
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
          {pagedRows.map((row) => (
            <TableRow key={row.id} hover>
              {columns.map((col) => (
                <TableCell
                  key={col.id}
                  align={col.align}
                  sx={{ whiteSpace: 'nowrap', ...col.cellSx }}
                >
                  {col.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={sortedRows.length}
        page={page}
        onPageChange={(_, newPage) => setPage(newPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={[10, 25, 50, 100]}
      />
    </Paper>
  );
}
