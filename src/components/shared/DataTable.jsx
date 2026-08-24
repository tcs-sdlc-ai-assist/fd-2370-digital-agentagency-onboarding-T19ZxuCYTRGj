import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';

const DEFAULT_PAGE_SIZE_OPTIONS = Object.freeze([10, 25, 50, 100]);

function getColumnId(column, index) {
  return String(
    column.id ??
      column.key ??
      column.accessorKey ??
      (typeof column.accessor === 'string'
        ? column.accessor
        : `column-${index}`),
  );
}

function getColumnLabel(column, columnId) {
  return column.header ?? column.label ?? columnId;
}

function getValueAtPath(value, path) {
  return String(path)
    .split('.')
    .reduce((currentValue, segment) => {
      if (currentValue === null || currentValue === undefined) {
        return undefined;
      }

      return currentValue[segment];
    }, value);
}

function getColumnValue(column, row, rowIndex) {
  if (typeof column.accessor === 'function') {
    return column.accessor(row, rowIndex);
  }

  const accessor =
    column.accessorKey ??
    (typeof column.accessor === 'string'
      ? column.accessor
      : column.key ?? column.id);

  return accessor === undefined
    ? undefined
    : getValueAtPath(row, accessor);
}

function getSortValue(column, row, rowIndex) {
  if (typeof column.sortValue === 'function') {
    return column.sortValue(row, rowIndex);
  }

  return getColumnValue(column, row, rowIndex);
}

function compareValues(leftValue, rightValue) {
  if (Object.is(leftValue, rightValue)) {
    return 0;
  }

  if (leftValue === null || leftValue === undefined) {
    return 1;
  }

  if (rightValue === null || rightValue === undefined) {
    return -1;
  }

  if (leftValue instanceof Date || rightValue instanceof Date) {
    const leftTime = new Date(leftValue).getTime();
    const rightTime = new Date(rightValue).getTime();

    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
      return leftTime - rightTime;
    }
  }

  if (
    typeof leftValue === 'number' &&
    typeof rightValue === 'number'
  ) {
    return leftValue - rightValue;
  }

  if (
    typeof leftValue === 'boolean' &&
    typeof rightValue === 'boolean'
  ) {
    return Number(leftValue) - Number(rightValue);
  }

  return String(leftValue).localeCompare(String(rightValue), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function getCellContent(column, value, row, rowIndex) {
  const renderer = column.render ?? column.cell;

  if (typeof renderer === 'function') {
    return renderer(value, row, rowIndex);
  }

  if (value === null || value === undefined || value === '') {
    return <span aria-label="Not available">—</span>;
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return String(value);
}

function normalizePageSizeOptions(options, pageSize) {
  const values = Array.isArray(options)
    ? options
    : DEFAULT_PAGE_SIZE_OPTIONS;

  return [
    ...new Set(
      [...values, pageSize].filter(
        (value) => Number.isInteger(value) && value > 0,
      ),
    ),
  ].sort((left, right) => left - right);
}

function resolveActionValue(value, row, rowIndex) {
  return typeof value === 'function' ? value(row, rowIndex) : value;
}

function RowActions({ actions, row, rowIndex }) {
  if (typeof actions === 'function') {
    return actions(row, rowIndex);
  }

  const visibleActions = actions.filter(
    (action) =>
      resolveActionValue(action.hidden, row, rowIndex) !== true,
  );

  if (visibleActions.length === 0) {
    return <span className="text-text-muted dark:text-slate-400">—</span>;
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {visibleActions.map((action, actionIndex) => {
        const label = resolveActionValue(
          action.label,
          row,
          rowIndex,
        );
        const actionId = String(
          action.id ?? action.key ?? label ?? actionIndex,
        );
        const disabled =
          resolveActionValue(action.disabled, row, rowIndex) === true;
        const ariaLabel =
          resolveActionValue(action.ariaLabel, row, rowIndex) ??
          (typeof label === 'string' ? label : `Row action ${actionIndex + 1}`);

        if (typeof action.render === 'function') {
          return (
            <span key={actionId}>
              {action.render({
                action,
                disabled,
                row,
                rowIndex,
              })}
            </span>
          );
        }

        return (
          <button
            aria-label={ariaLabel}
            className={`inline-flex min-h-9 items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800 ${action.className ?? ''}`.trim()}
            disabled={disabled}
            key={actionId}
            onClick={(event) => {
              event.stopPropagation();

              if (typeof action.onClick === 'function') {
                action.onClick(row, event, rowIndex);
              }
            }}
            type="button"
          >
            {action.icon && (
              <span aria-hidden="true" className="mr-1.5 shrink-0">
                {action.icon}
              </span>
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}

RowActions.propTypes = {
  actions: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.object),
    PropTypes.func,
  ]).isRequired,
  row: PropTypes.object.isRequired,
  rowIndex: PropTypes.number.isRequired,
};

/**
 * Displays responsive tabular data with sorting, pagination, empty states,
 * keyboard navigation, and optional row actions.
 */
export function DataTable({
  'aria-label': ariaLabel = 'Data table',
  caption,
  className = '',
  columns,
  data = null,
  rows = null,
  defaultPage = 1,
  defaultPageSize = 25,
  defaultSortBy = null,
  defaultSortDirection = 'asc',
  emptyMessage = 'No records found.',
  emptyState = null,
  getRowId,
  loading = false,
  loadingMessage = 'Loading records…',
  manualPagination = false,
  manualSorting = false,
  onPageChange,
  onPageSizeChange,
  onRowClick,
  onSort,
  onSortChange,
  page,
  pageSize,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  pagination = true,
  rowActions = null,
  rowActionsLabel = 'Actions',
  sortBy,
  sortDirection,
  totalCount,
}) {
  const [internalPage, setInternalPage] = useState(defaultPage);
  const [internalPageSize, setInternalPageSize] =
    useState(defaultPageSize);
  const [internalSort, setInternalSort] = useState({
    columnId: defaultSortBy,
    direction: defaultSortDirection,
  });
  const sourceRows = data ?? rows ?? [];
  const effectivePageSize = pageSize ?? internalPageSize;
  const requestedPage = page ?? internalPage;
  const effectiveSortBy = sortBy ?? internalSort.columnId;
  const effectiveSortDirection =
    sortDirection ?? internalSort.direction;
  const normalizedColumns = useMemo(
    () =>
      columns.map((column, index) => ({
        ...column,
        columnId: getColumnId(column, index),
      })),
    [columns],
  );
  const sortableRows = useMemo(() => {
    if (!effectiveSortBy || manualSorting) {
      return [...sourceRows];
    }

    const column = normalizedColumns.find(
      (candidate) => candidate.columnId === effectiveSortBy,
    );

    if (!column || column.sortable === false) {
      return [...sourceRows];
    }

    const direction = effectiveSortDirection === 'desc' ? -1 : 1;

    return sourceRows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const leftValue = getSortValue(
          column,
          left.row,
          left.index,
        );
        const rightValue = getSortValue(
          column,
          right.row,
          right.index,
        );
        const result =
          typeof column.sortComparator === 'function'
            ? column.sortComparator(
                leftValue,
                rightValue,
                left.row,
                right.row,
              )
            : compareValues(leftValue, rightValue);

        return result === 0
          ? left.index - right.index
          : result * direction;
      })
      .map(({ row }) => row);
  }, [
    effectiveSortBy,
    effectiveSortDirection,
    manualSorting,
    normalizedColumns,
    sourceRows,
  ]);
  const recordCount =
    totalCount ?? (manualPagination ? sourceRows.length : sortableRows.length);
  const totalPages = Math.max(
    1,
    Math.ceil(recordCount / effectivePageSize),
  );
  const effectivePage = Math.min(
    Math.max(1, requestedPage),
    totalPages,
  );
  const visibleRows = useMemo(() => {
    if (!pagination || manualPagination) {
      return sortableRows;
    }

    const start = (effectivePage - 1) * effectivePageSize;

    return sortableRows.slice(start, start + effectivePageSize);
  }, [
    effectivePage,
    effectivePageSize,
    manualPagination,
    pagination,
    sortableRows,
  ]);
  const hasRowActions =
    typeof rowActions === 'function' ||
    (Array.isArray(rowActions) && rowActions.length > 0);
  const columnCount =
    normalizedColumns.length + (hasRowActions ? 1 : 0);
  const firstRecord =
    recordCount === 0
      ? 0
      : (effectivePage - 1) * effectivePageSize + 1;
  const lastRecord =
    recordCount === 0
      ? 0
      : Math.min(
          recordCount,
          manualPagination
            ? firstRecord + visibleRows.length - 1
            : effectivePage * effectivePageSize,
        );

  const changePage = (nextPage) => {
    const normalizedPage = Math.min(
      Math.max(1, nextPage),
      totalPages,
    );

    if (page === undefined) {
      setInternalPage(normalizedPage);
    }

    if (typeof onPageChange === 'function') {
      onPageChange(normalizedPage);
    }
  };

  const changePageSize = (event) => {
    const nextPageSize = Number(event.target.value);

    if (pageSize === undefined) {
      setInternalPageSize(nextPageSize);
    }

    if (page === undefined) {
      setInternalPage(1);
    }

    if (typeof onPageSizeChange === 'function') {
      onPageSizeChange(nextPageSize);
    }

    if (typeof onPageChange === 'function') {
      onPageChange(1);
    }
  };

  const changeSort = (column) => {
    if (column.sortable === false) {
      return;
    }

    const nextDirection =
      effectiveSortBy === column.columnId &&
      effectiveSortDirection === 'asc'
        ? 'desc'
        : 'asc';
    const nextSort = {
      columnId: column.columnId,
      sortBy: column.columnId,
      direction: nextDirection,
    };

    if (sortBy === undefined && sortDirection === undefined) {
      setInternalSort(nextSort);
    }

    if (typeof onSortChange === 'function') {
      onSortChange(nextSort);
    }

    if (typeof onSort === 'function') {
      onSort(column.columnId, nextDirection, nextSort);
    }
  };

  const handleRowKeyDown = (event, row, rowIndex) => {
    if (
      typeof onRowClick !== 'function' ||
      event.target !== event.currentTarget ||
      !['Enter', ' '].includes(event.key)
    ) {
      return;
    }

    event.preventDefault();
    onRowClick(row, rowIndex, event);
  };

  return (
    <section
      aria-busy={loading}
      className={`w-full ${className}`.trim()}
    >
      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900">
        <table
          aria-label={ariaLabel}
          className="min-w-full border-collapse text-left"
        >
          {caption && <caption className="sr-only">{caption}</caption>}

          <thead className="bg-surface-muted dark:bg-slate-800">
            <tr>
              {normalizedColumns.map((column) => {
                const label = getColumnLabel(
                  column,
                  column.columnId,
                );
                const sorted =
                  effectiveSortBy === column.columnId;
                const ariaSort = sorted
                  ? effectiveSortDirection === 'desc'
                    ? 'descending'
                    : 'ascending'
                  : 'none';

                return (
                  <th
                    aria-sort={
                      column.sortable === false
                        ? undefined
                        : ariaSort
                    }
                    className={`whitespace-nowrap border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted dark:border-slate-700 dark:text-slate-300 ${column.headerClassName ?? ''}`.trim()}
                    key={column.columnId}
                    scope="col"
                  >
                    {column.sortable === false ? (
                      label
                    ) : (
                      <button
                        aria-label={`Sort by ${typeof label === 'string' ? label : column.columnId}`}
                        className="inline-flex min-h-9 items-center gap-2 rounded-md text-left transition-colors hover:text-lga-navy focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:hover:text-white dark:focus:ring-offset-slate-800"
                        onClick={() => changeSort(column)}
                        type="button"
                      >
                        <span>{label}</span>
                        <span
                          aria-hidden="true"
                          className={
                            sorted
                              ? 'text-lga-sky'
                              : 'text-slate-400'
                          }
                        >
                          {sorted &&
                          effectiveSortDirection === 'desc'
                            ? '▼'
                            : '▲'}
                        </span>
                      </button>
                    )}
                  </th>
                );
              })}

              {hasRowActions && (
                <th
                  className="border-b border-border px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-text-muted dark:border-slate-700 dark:text-slate-300"
                  scope="col"
                >
                  {rowActionsLabel}
                </th>
              )}
            </tr>
          </thead>

          <tbody className="divide-y divide-border dark:divide-slate-700">
            {loading && (
              <tr>
                <td
                  className="px-4 py-12 text-center text-sm text-text-muted dark:text-slate-300"
                  colSpan={columnCount}
                >
                  <span role="status">{loadingMessage}</span>
                </td>
              </tr>
            )}

            {!loading && visibleRows.length === 0 && (
              <tr>
                <td
                  className="px-4 py-12 text-center text-sm text-text-muted dark:text-slate-300"
                  colSpan={columnCount}
                >
                  {emptyState ?? (
                    <div className="mx-auto max-w-md">
                      <p className="font-medium text-text dark:text-white">
                        {emptyMessage}
                      </p>
                    </div>
                  )}
                </td>
              </tr>
            )}

            {!loading &&
              visibleRows.map((row, rowIndex) => {
                const absoluteRowIndex = manualPagination
                  ? rowIndex
                  : (effectivePage - 1) * effectivePageSize +
                    rowIndex;
                const rowId =
                  typeof getRowId === 'function'
                    ? getRowId(row, absoluteRowIndex)
                    : row.id ??
                      row.applicationId ??
                      row.trackingId ??
                      row.workItemId ??
                      row.notificationId ??
                      row.syncAttemptId ??
                      row.changeRequestId ??
                      absoluteRowIndex;
                const interactive =
                  typeof onRowClick === 'function';

                return (
                  <tr
                    className={`transition-colors hover:bg-surface-muted dark:hover:bg-slate-800 ${
                      interactive
                        ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-lga-sky'
                        : ''
                    }`}
                    key={String(rowId)}
                    onClick={
                      interactive
                        ? (event) =>
                            onRowClick(
                              row,
                              absoluteRowIndex,
                              event,
                            )
                        : undefined
                    }
                    onKeyDown={(event) =>
                      handleRowKeyDown(
                        event,
                        row,
                        absoluteRowIndex,
                      )
                    }
                    tabIndex={interactive ? 0 : undefined}
                  >
                    {normalizedColumns.map((column) => {
                      const value = getColumnValue(
                        column,
                        row,
                        absoluteRowIndex,
                      );

                      return (
                        <td
                          className={`px-4 py-3 text-sm text-text dark:text-slate-100 ${column.className ?? column.cellClassName ?? ''}`.trim()}
                          key={column.columnId}
                        >
                          {getCellContent(
                            column,
                            value,
                            row,
                            absoluteRowIndex,
                          )}
                        </td>
                      );
                    })}

                    {hasRowActions && (
                      <td className="px-4 py-3 text-right">
                        <RowActions
                          actions={rowActions}
                          row={row}
                          rowIndex={absoluteRowIndex}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {pagination && !loading && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p
            aria-live="polite"
            className="text-sm text-text-muted dark:text-slate-300"
          >
            Showing {firstRecord}–{lastRecord} of {recordCount}
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm text-text-muted dark:text-slate-300">
              <span>Rows per page</span>
              <select
                aria-label="Rows per page"
                className="min-h-10 rounded-lg border border-border bg-white px-2 py-1 text-text focus:outline-none focus:ring-2 focus:ring-lga-sky dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                onChange={changePageSize}
                value={effectivePageSize}
              >
                {normalizePageSizeOptions(
                  pageSizeOptions,
                  effectivePageSize,
                ).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2">
              <button
                aria-label="Previous page"
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
                disabled={effectivePage <= 1}
                onClick={() => changePage(effectivePage - 1)}
                type="button"
              >
                Previous
              </button>

              <span className="min-w-24 text-center text-sm text-text-muted dark:text-slate-300">
                Page {effectivePage} of {totalPages}
              </span>

              <button
                aria-label="Next page"
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
                disabled={effectivePage >= totalPages}
                onClick={() => changePage(effectivePage + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

DataTable.propTypes = {
  'aria-label': PropTypes.string,
  caption: PropTypes.node,
  className: PropTypes.string,
  columns: PropTypes.arrayOf(
    PropTypes.shape({
      accessor: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.func,
      ]),
      accessorKey: PropTypes.string,
      cell: PropTypes.func,
      cellClassName: PropTypes.string,
      className: PropTypes.string,
      header: PropTypes.node,
      headerClassName: PropTypes.string,
      id: PropTypes.string,
      key: PropTypes.string,
      label: PropTypes.node,
      render: PropTypes.func,
      sortComparator: PropTypes.func,
      sortable: PropTypes.bool,
      sortValue: PropTypes.func,
    }),
  ).isRequired,
  data: PropTypes.arrayOf(PropTypes.object),
  defaultPage: PropTypes.number,
  defaultPageSize: PropTypes.number,
  defaultSortBy: PropTypes.string,
  defaultSortDirection: PropTypes.oneOf(['asc', 'desc']),
  emptyMessage: PropTypes.node,
  emptyState: PropTypes.node,
  getRowId: PropTypes.func,
  loading: PropTypes.bool,
  loadingMessage: PropTypes.node,
  manualPagination: PropTypes.bool,
  manualSorting: PropTypes.bool,
  onPageChange: PropTypes.func,
  onPageSizeChange: PropTypes.func,
  onRowClick: PropTypes.func,
  onSort: PropTypes.func,
  onSortChange: PropTypes.func,
  page: PropTypes.number,
  pageSize: PropTypes.number,
  pageSizeOptions: PropTypes.arrayOf(PropTypes.number),
  pagination: PropTypes.bool,
  rowActions: PropTypes.oneOfType([
    PropTypes.arrayOf(
      PropTypes.shape({
        ariaLabel: PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.func,
        ]),
        className: PropTypes.string,
        disabled: PropTypes.oneOfType([
          PropTypes.bool,
          PropTypes.func,
        ]),
        hidden: PropTypes.oneOfType([
          PropTypes.bool,
          PropTypes.func,
        ]),
        icon: PropTypes.node,
        id: PropTypes.string,
        key: PropTypes.string,
        label: PropTypes.oneOfType([
          PropTypes.node,
          PropTypes.func,
        ]),
        onClick: PropTypes.func,
        render: PropTypes.func,
      }),
    ),
    PropTypes.func,
  ]),
  rowActionsLabel: PropTypes.node,
  rows: PropTypes.arrayOf(PropTypes.object),
  sortBy: PropTypes.string,
  sortDirection: PropTypes.oneOf(['asc', 'desc']),
  totalCount: PropTypes.number,
};

export default DataTable;