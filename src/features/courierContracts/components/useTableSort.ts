import { useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  columnId: string;
  direction: SortDirection;
}

/** Returns a sort value for a row; `null`/`undefined` always sort last. */
export type SortValueGetter<T> = (row: T) => number | string | null | undefined;

/**
 * Header-click sorting with the cycle: none → desc → asc → none.
 * Rows are sorted by the active column's value getter; nullish values are
 * pushed to the bottom regardless of direction.
 */
export function useTableSort<T>(
  rows: T[],
  getters: Record<string, SortValueGetter<T>>,
) {
  const [sort, setSort] = useState<SortState | null>(null);

  const cycleSort = (columnId: string) => {
    setSort((prev) => {
      if (!prev || prev.columnId !== columnId) return { columnId, direction: 'desc' };
      if (prev.direction === 'desc') return { columnId, direction: 'asc' };
      return null; // was 'asc' → clear
    });
  };

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const getter = getters[sort.columnId];
    if (!getter) return rows;

    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      const aNull = va === null || va === undefined;
      const bNull = vb === null || vb === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1; // nulls last
      if (bNull) return -1;
      if (typeof va === 'string' || typeof vb === 'string') {
        return factor * String(va).localeCompare(String(vb));
      }
      return factor * (va - vb);
    });
    // getters object is stable per render of the parent definition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  return { sort, cycleSort, sortedRows };
}
