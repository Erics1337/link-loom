"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";

type LinksPaginationProps = {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  offset: number;
  itemsPerPage: number;
  query?: string;
};

export function LinksPagination({
  currentPage,
  totalPages,
  totalCount,
  offset,
  itemsPerPage,
  query = "",
}: LinksPaginationProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/dashboard/links?${qs}` : "/dashboard/links";
  };

  const navigate = (href: string) => {
    startTransition(() => {
      router.push(href);
    });
  };

  const pageNumbers = getPageNumbers(currentPage, totalPages);

  return (
    <div
      className="flex flex-col gap-4 border-t border-ll-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
      aria-busy={isPending}
    >
      <div className="flex items-center gap-2 text-sm text-ll-muted">
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin text-ll-accent" aria-hidden="true" />
        ) : null}
        <span>
          Showing{" "}
          <span className="font-medium text-ll-text">{offset + 1}</span> to{" "}
          <span className="font-medium text-ll-text">
            {Math.min(offset + itemsPerPage, totalCount)}
          </span>{" "}
          of <span className="font-medium text-ll-text">{totalCount}</span> results
        </span>
      </div>

      <nav
        className="flex flex-wrap items-center gap-2"
        aria-label="Links pagination"
      >
        {currentPage > 1 ? (
          <PaginationLink
            href={buildHref(currentPage - 1)}
            label="Previous page"
            onNavigate={navigate}
            className="ll-action-secondary px-3 py-1.5 text-sm"
          >
            Previous
          </PaginationLink>
        ) : null}

        {pageNumbers.map((page, index) =>
          page === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="px-1 text-sm text-ll-muted">
              …
            </span>
          ) : (
            <PaginationLink
              key={page}
              href={buildHref(page)}
              label={`Page ${page}`}
              onNavigate={navigate}
              aria-current={page === currentPage ? "page" : undefined}
              className={`min-w-9 px-3 py-1.5 text-sm ${
                page === currentPage
                  ? "rounded-ll-md bg-ll-accent-soft font-semibold text-ll-accent"
                  : "ll-action-secondary"
              }`}
            >
              {page}
            </PaginationLink>
          ),
        )}

        {currentPage < totalPages ? (
          <PaginationLink
            href={buildHref(currentPage + 1)}
            label="Next page"
            onNavigate={navigate}
            className="ll-action-secondary px-3 py-1.5 text-sm"
          >
            Next
          </PaginationLink>
        ) : null}
      </nav>
    </div>
  );
}

function PaginationLink({
  href,
  children,
  label,
  onNavigate,
  className,
  ...rest
}: {
  href: string;
  children: ReactNode;
  label: string;
  onNavigate: (href: string) => void;
  className?: string;
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(href);
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}

function getPageNumbers(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages: Array<number | "ellipsis"> = [1];

  if (current > 3) pages.push("ellipsis");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  if (current < total - 2) pages.push("ellipsis");

  pages.push(total);
  return pages;
}
