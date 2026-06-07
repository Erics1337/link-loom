import { createClient } from "@/utils/supabase/server";
import {
  Link as LinkIcon,
  FolderTree,
  ExternalLink,
} from "lucide-react";
import { AddLinkModal } from "@/components/AddLinkModal";
import { LinksPagination } from "@/components/dashboard/LinksPagination";
import { LinksSearchBar } from "@/components/dashboard/LinksSearchBar";
import {
  DashboardPanelHeader,
  DashboardTopbar,
  formatRelativeTime,
} from "../dashboard-ui";

const sanitizeSearchTerm = (value: string) =>
  value
    .replace(/[,%()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

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

  const query = sanitizeSearchTerm(searchParams?.query || "");
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
      <DashboardTopbar title="My Links">
        <div className="flex items-center gap-4">
          <LinksSearchBar defaultQuery={query} />
          <AddLinkModal />
        </div>
      </DashboardTopbar>

      <div className="p-8">
        <div className="ll-panel">
          <DashboardPanelHeader
            title={query ? `Search Results for "${query}"` : "All Bookmarks"}
            summary={`${count ?? 0} total`}
          />

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
                  <li key={bookmark.id} className="ll-row min-h-[6.5rem] p-6">
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
            <LinksPagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalCount={count || 0}
              offset={offset}
              itemsPerPage={ITEMS_PER_PAGE}
              query={query}
            />
          )}
        </div>
      </div>
    </div>
  );
}
