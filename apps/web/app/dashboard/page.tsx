import { createClient } from "@/utils/supabase/server";
import { Link as LinkIcon, Search, Bookmark, FolderTree } from "lucide-react";
import { AddLinkModal } from "@/components/AddLinkModal";

// Helper to format relative time
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

export default async function Dashboard() {
  const supabase = createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <div>Please log in</div>;
  }

  // Fetch real stats from Supabase
  const [bookmarkResult, clusterResult, recentResult, userResult] =
    await Promise.all([
      // Total bookmark count
      supabase
        .from("bookmarks")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id),

      // Cluster/folder count
      supabase
        .from("clusters")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id),

      // Recent bookmarks with cluster assignments
      supabase
        .from("bookmarks")
        .select(
          `
                id, 
                title, 
                url, 
                created_at,
                cluster_assignments (
                    clusters (name)
                )
            `,
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5),

      // Get user premium status
      supabase.from("users").select("is_premium").eq("id", user.id).single(),
    ]);

  const bookmarkCount = bookmarkResult.count ?? 0;
  const clusterCount = clusterResult.count ?? 0;
  const recentBookmarks = recentResult.data ?? [];
  const isPremium = userResult.data?.is_premium ?? false;
  const bookmarkLimit = isPremium ? "∞" : "500";

  const stats = [
    {
      name: "Total Bookmarks",
      value: bookmarkCount.toLocaleString(),
      change: `of ${bookmarkLimit}`,
      changeType: "neutral" as const,
    },
    {
      name: "Folders Created",
      value: clusterCount.toLocaleString(),
      change: "organized",
      changeType: "positive" as const,
    },
    {
      name: "Plan",
      value: isPremium ? "Pro" : "Free",
      change: isPremium ? "Unlimited" : "500 limit",
      changeType: isPremium ? ("positive" as const) : ("neutral" as const),
    },
  ];

  return (
    <div>
      {/* Topbar */}
      <header className="ll-topbar">
        <h1 className="text-xl font-semibold text-ll-text">Dashboard</h1>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ll-muted" />
            <input
              type="text"
              placeholder="Search links..."
              className="ll-input w-64 rounded-full py-1.5 pl-10 pr-4 text-sm"
            />
          </div>
          <AddLinkModal />
        </div>
      </header>

      <div className="p-8 space-y-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {stats.map((item) => (
            <div key={item.name} className="ll-panel-solid p-6">
              <dt className="flex items-center gap-2 text-sm font-medium text-ll-muted">
                {item.name === "Total Bookmarks" && (
                  <Bookmark className="w-4 h-4" />
                )}
                {item.name === "Folders Created" && (
                  <FolderTree className="w-4 h-4" />
                )}
                {item.name}
              </dt>
              <dd className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-semibold text-ll-text">
                  {item.value}
                </span>
                <span
                  className={`text-sm font-medium ${item.changeType === "positive" ? "text-ll-success" : "text-ll-muted"}`}
                >
                  {item.change}
                </span>
              </dd>
            </div>
          ))}
        </div>

        {/* Recent Activity */}
        <div className="ll-panel">
          <div className="ll-panel-header">
            <h3 className="text-base font-semibold leading-6 text-ll-text">
              Recent Bookmarks
            </h3>
            <span className="text-sm text-ll-muted">{bookmarkCount} total</span>
          </div>
          {recentBookmarks.length === 0 ? (
            <div className="px-6 py-12 text-center text-ll-muted">
              <Bookmark className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No bookmarks yet. Install the extension to get started!</p>
            </div>
          ) : (
            <ul role="list" className="divide-y divide-ll-border">
              {recentBookmarks.map((item: any) => {
                const clusterName =
                  item.cluster_assignments?.[0]?.clusters?.name;
                return (
                  <li key={item.id} className="ll-row px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-ll-md border border-ll-border bg-ll-accent-soft">
                        <LinkIcon className="h-5 w-5 text-ll-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-ll-text">
                          {item.title || "Untitled"}
                        </p>
                        <p className="truncate text-xs text-ll-muted">
                          {item.url}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        {clusterName && (
                          <span className="ll-tag">{clusterName}</span>
                        )}
                        <span className="text-sm text-ll-muted">
                          {formatRelativeTime(item.created_at)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Upgrade Banner - Only show for free users */}
        {!isPremium && (
          <div className="ll-panel relative isolate px-6 py-8 sm:px-16 md:pt-12 lg:flex lg:gap-x-20 lg:px-24 lg:pt-0">
            <div className="mx-auto max-w-md text-center lg:mx-0 lg:flex-auto lg:py-16 lg:text-left">
              <h2 className="text-3xl font-bold tracking-tight text-ll-text sm:text-4xl">
                Unlock full potential.
                <br />
                Start using Link Loom Pro today.
              </h2>
              <p className="mt-6 text-lg leading-8 text-ll-muted">
                Get unlimited bookmarks, advanced AI auto-tagging, and priority
                support.
              </p>
              <div className="mt-10 flex items-center justify-center gap-x-6 lg:justify-start">
                <a
                  href="/dashboard/billing"
                  className="ll-action-primary px-3.5 py-2.5 text-sm"
                >
                  Upgrade to Pro
                </a>
                <a
                  href="#"
                  className="text-sm font-semibold leading-6 text-ll-accent"
                >
                  Learn more <span aria-hidden="true">→</span>
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
