import { createClient } from "@/utils/supabase/server";
import {
  Link as LinkIcon,
  Search,
  FolderTree,
  ExternalLink,
} from "lucide-react";
import { AddLinkModal } from "@/components/AddLinkModal";

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default async function LinksPage({
  searchParams,
}: {
  searchParams?: { query?: string; page?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <div>Please log in</div>;
  }

  const query = searchParams?.query || "";
  const currentPage = Number(searchParams?.page) || 1;
  const ITEMS_PER_PAGE = 20;
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  let dbQuery = supabase
    .from("bookmarks")
    .select(
      `
            id, 
            title, 
            url, 
            description,
            created_at,
            status,
            cluster_assignments (
                clusters (name)
            )
        `,
      { count: "exact" },
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + ITEMS_PER_PAGE - 1);

  if (query) {
    // Simple search across title, url, description
    dbQuery = dbQuery.or(
      `title.ilike.%${query}%,url.ilike.%${query}%,description.ilike.%${query}%`,
    );
  }

  const { data: bookmarks, count } = await dbQuery;

  const totalPages = count ? Math.ceil(count / ITEMS_PER_PAGE) : 0;

  return (
    <div>
      {/* Topbar */}
      <header className="ll-topbar">
        <h1 className="text-xl font-semibold text-ll-text">My Links</h1>
        <div className="flex items-center gap-4">
          {/* Native HTML form for searchParams routing */}
          <form method="GET" action="/dashboard/links" className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ll-muted" />
            <input
              type="text"
              name="query"
              defaultValue={query}
              placeholder="Search links..."
              className="ll-input w-64 rounded-full py-1.5 pl-10 pr-4 text-sm"
            />
          </form>
          <AddLinkModal />
        </div>
      </header>

      <div className="p-8">
        <div className="ll-panel">
          <div className="ll-panel-header">
            <h3 className="text-base font-semibold leading-6 text-ll-text">
              {query ? `Search Results for "${query}"` : "All Bookmarks"}
            </h3>
            <span className="text-sm text-ll-muted">{count} total</span>
          </div>

          {!bookmarks || bookmarks.length === 0 ? (
            <div className="px-6 py-12 text-center text-ll-muted">
              <LinkIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>
                {query
                  ? "No bookmarks found matching your search."
                  : "You have no links saved yet."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-ll-border">
              {bookmarks.map((bookmark: any) => {
                const clusterName =
                  bookmark.cluster_assignments?.[0]?.clusters?.name;
                return (
                  <li key={bookmark.id} className="ll-row p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <h4 className="line-clamp-1 text-base font-medium text-ll-text">
                            {bookmark.title || bookmark.url}
                          </h4>
                          {clusterName && (
                            <span className="ll-tag">
                              <FolderTree className="w-3 h-3" />
                              {clusterName}
                            </span>
                          )}
                        </div>
                        <a
                          href={bookmark.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ll-link mb-2 flex max-w-max items-center gap-1.5 text-sm line-clamp-1"
                        >
                          {bookmark.url}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        {bookmark.description && (
                          <p className="mb-3 line-clamp-2 text-sm text-ll-muted">
                            {bookmark.description}
                          </p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-ll-muted">
                          <span>
                            Added {formatRelativeTime(bookmark.created_at)}
                          </span>
                          <span className="rounded-full border border-ll-border bg-ll-card px-1.5 py-0.5 capitalize">
                            Status: {bookmark.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-ll-border px-6 py-4">
              <div className="text-sm text-ll-muted">
                Showing{" "}
                <span className="font-medium text-ll-text">{offset + 1}</span>{" "}
                to{" "}
                <span className="font-medium text-ll-text">
                  {Math.min(offset + ITEMS_PER_PAGE, count || 0)}
                </span>{" "}
                of <span className="font-medium text-ll-text">{count}</span>{" "}
                results
              </div>
              <div className="flex items-center gap-2">
                {currentPage > 1 && (
                  <a
                    href={`/dashboard/links?page=${currentPage - 1}${query ? `&query=${encodeURIComponent(query)}` : ""}`}
                    className="ll-action-secondary px-3 py-1.5 text-sm"
                  >
                    Previous
                  </a>
                )}
                {currentPage < totalPages && (
                  <a
                    href={`/dashboard/links?page=${currentPage + 1}${query ? `&query=${encodeURIComponent(query)}` : ""}`}
                    className="ll-action-secondary px-3 py-1.5 text-sm"
                  >
                    Next
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
