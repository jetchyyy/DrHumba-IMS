import React from "react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

export interface DataTablePaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  itemsPerPage?: number;
  onItemsPerPageChange?: (itemsPerPage: number) => void;
  pageSizeOptions?: number[];
  showPageSizeSelector?: boolean;
  className?: string;
}

/**
 * Builds a sliding window of page numbers with ellipsis:
 * Always shows first page, last page, current page, and sibling pages.
 * Handles edge cases cleanly when totalPages <= 7 or when near edges.
 */
export function getPaginationRange(
  current: number,
  total: number,
  siblingCount: number = 1
): (number | "ellipsis")[] {
  // If total pages is 7 or fewer, show all pages without any ellipsis
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const leftSiblingIndex = Math.max(current - siblingCount, 1);
  const rightSiblingIndex = Math.min(current + siblingCount, total);

  const shouldShowLeftDots = leftSiblingIndex > 2;
  const shouldShowRightDots = rightSiblingIndex < total - 2;

  // Case 1: No left ellipsis, only right ellipsis (e.g., 1 2 3 4 5 ... 25)
  if (!shouldShowLeftDots && shouldShowRightDots) {
    const leftItemCount = 3 + 2 * siblingCount;
    const leftRange = Array.from({ length: leftItemCount }, (_, i) => i + 1);
    return [...leftRange, "ellipsis", total];
  }

  // Case 2: Only left ellipsis (e.g., 1 ... 21 22 23 24 25)
  if (shouldShowLeftDots && !shouldShowRightDots) {
    const rightItemCount = 3 + 2 * siblingCount;
    const rightRange = Array.from(
      { length: rightItemCount },
      (_, i) => total - rightItemCount + 1 + i
    );
    return [1, "ellipsis", ...rightRange];
  }

  // Case 3: Both left and right ellipsis (e.g., 1 ... 9 10 11 ... 25)
  if (shouldShowLeftDots && shouldShowRightDots) {
    const middleRange = Array.from(
      { length: rightSiblingIndex - leftSiblingIndex + 1 },
      (_, i) => leftSiblingIndex + i
    );
    return [1, "ellipsis", ...middleRange, "ellipsis", total];
  }

  return Array.from({ length: total }, (_, i) => i + 1);
}

export const DataTablePagination: React.FC<DataTablePaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  itemsPerPage,
  onItemsPerPageChange,
  pageSizeOptions = [10, 20, 50, 100],
  showPageSizeSelector = false,
  className = "",
}) => {
  if (totalPages <= 1 && !totalItems && !showPageSizeSelector) {
    return null;
  }

  const pageRange = getPaginationRange(currentPage, totalPages);

  // Compute item range display (e.g., Showing 1-10 of 250 items)
  const startItem = totalItems !== undefined && itemsPerPage !== undefined
    ? Math.min((currentPage - 1) * itemsPerPage + 1, totalItems)
    : undefined;
  const endItem = totalItems !== undefined && itemsPerPage !== undefined
    ? Math.min(currentPage * itemsPerPage, totalItems)
    : undefined;

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-4 py-4 px-2 sm:px-4 text-xs select-none ${className}`}
    >
      {/* Left side: Rows per page & Item range counters */}
      <div className="flex flex-wrap items-center gap-3 text-muted-foreground w-full sm:w-auto justify-between sm:justify-start">
        {showPageSizeSelector && onItemsPerPageChange && itemsPerPage !== undefined && (
          <div className="flex items-center gap-2">
            <span className="font-medium whitespace-nowrap">Rows per page</span>
            <Select
              value={String(itemsPerPage)}
              onValueChange={(val) => {
                onItemsPerPageChange(Number(val));
                onPageChange(1); // Reset to first page on size change
              }}
            >
              <SelectTrigger className="h-8 w-[72px] text-xs bg-background">
                <SelectValue placeholder={String(itemsPerPage)} />
              </SelectTrigger>
              <SelectContent side="top">
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)} className="text-xs">
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {totalItems !== undefined && (
          <div className="font-medium text-muted-foreground">
            {totalItems === 0 ? (
              <span>0 items</span>
            ) : startItem !== undefined && endItem !== undefined ? (
              <span>
                Showing <strong className="text-foreground">{startItem}</strong> -{" "}
                <strong className="text-foreground">{endItem}</strong> of{" "}
                <strong className="text-foreground">{totalItems}</strong>
              </span>
            ) : (
              <span>
                Total: <strong className="text-foreground">{totalItems}</strong> items
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right side: Modern Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1 w-full sm:w-auto justify-center sm:justify-end">
          <Pagination className="mx-0 w-auto">
            <PaginationContent className="gap-1">
              {/* Jump to first page button on larger screens */}
              <PaginationItem className="hidden md:inline-flex">
                <PaginationLink
                  aria-label="Go to first page"
                  onClick={() => onPageChange(1)}
                  className={`h-8 w-8 p-0 ${
                    currentPage === 1 ? "pointer-events-none opacity-40" : "cursor-pointer hover:bg-muted"
                  }`}
                  size="icon"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </PaginationLink>
              </PaginationItem>

              {/* Previous page */}
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                  className={`h-8 px-2.5 text-xs ${
                    currentPage === 1 ? "pointer-events-none opacity-40" : "cursor-pointer hover:bg-muted"
                  }`}
                />
              </PaginationItem>

              {/* Numbered Page Buttons & Ellipsis for Tablets and Desktops */}
              <div className="hidden sm:flex items-center gap-1">
                {pageRange.map((page, idx) =>
                  page === "ellipsis" ? (
                    <PaginationItem key={`ellipsis-${idx}`}>
                      <PaginationEllipsis className="h-8 w-8 text-muted-foreground" />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={page}>
                      <PaginationLink
                        onClick={() => onPageChange(page)}
                        isActive={currentPage === page}
                        className={`h-8 w-8 p-0 text-xs cursor-pointer font-medium transition-colors ${
                          currentPage === page
                            ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground shadow-sm"
                            : "hover:bg-muted"
                        }`}
                        size="icon"
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  )
                )}
              </div>

              {/* Compact Mobile Page Indicator */}
              <div className="sm:hidden px-3 text-xs font-semibold text-foreground">
                {currentPage} / {totalPages}
              </div>

              {/* Next page */}
              <PaginationItem>
                <PaginationNext
                  onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                  className={`h-8 px-2.5 text-xs ${
                    currentPage === totalPages ? "pointer-events-none opacity-40" : "cursor-pointer hover:bg-muted"
                  }`}
                />
              </PaginationItem>

              {/* Jump to last page button on larger screens */}
              <PaginationItem className="hidden md:inline-flex">
                <PaginationLink
                  aria-label="Go to last page"
                  onClick={() => onPageChange(totalPages)}
                  className={`h-8 w-8 p-0 ${
                    currentPage === totalPages ? "pointer-events-none opacity-40" : "cursor-pointer hover:bg-muted"
                  }`}
                  size="icon"
                >
                  <ChevronsRight className="h-4 w-4" />
                </PaginationLink>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
};
