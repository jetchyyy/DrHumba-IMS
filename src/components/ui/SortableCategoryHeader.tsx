import React from 'react';
import { CaretSortIcon, ArrowUpIcon, ArrowDownIcon } from '@radix-ui/react-icons';
import { TableHead } from './table';
import type { CategorySortOrder } from '../../lib/utils';

interface SortableCategoryHeaderProps {
  sortOrder: CategorySortOrder;
  onToggle: () => void;
  className?: string;
}

/**
 * Clickable table header cell for sorting rows by Category (none -> A-Z -> Z-A).
 */
export const SortableCategoryHeader: React.FC<SortableCategoryHeaderProps> = ({
  sortOrder,
  onToggle,
  className,
}) => {
  const title =
    sortOrder === 'none'
      ? 'Sort by Category (A–Z)'
      : sortOrder === 'asc'
      ? 'Sorted A–Z (click for Z–A)'
      : 'Sorted Z–A (click to reset)';

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer select-none"
        title={title}
      >
        <span>Category</span>
        {sortOrder === 'asc' ? (
          <ArrowUpIcon className="h-3.5 w-3.5 text-primary" />
        ) : sortOrder === 'desc' ? (
          <ArrowDownIcon className="h-3.5 w-3.5 text-primary" />
        ) : (
          <CaretSortIcon className="h-4 w-4 opacity-50" />
        )}
      </button>
    </TableHead>
  );
};
