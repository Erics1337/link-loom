import { createClient } from "@/utils/supabase/server";
import { History, Save } from "lucide-react";
import { CloudSnapshotActions } from "@/components/BackupActions";
import {
  DashboardPanelHeader,
  DashboardTopbar,
  formatRelativeTime,
} from "../dashboard-ui";

export default async function CloudSnapshotsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <div>Please log in</div>;
  }

  // Fetch Cloud Snapshots from the backend-compatible structure_snapshots table.
  const { data: snapshots, count } = await supabase
    .from("structure_snapshots")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <DashboardTopbar
        title={
          <div className="flex items-center gap-3">
            <History className="h-5 w-5 text-ll-accent" />
            <h1 className="text-xl font-semibold text-ll-text">
              Cloud Snapshots
            </h1>
          </div>
        }
      />

      <div className="p-8">
        <div className="mb-8 max-w-3xl">
          <h2 className="mb-2 text-lg font-medium text-ll-text">
            Preserve your organized clusters
          </h2>
          <p className="text-ll-muted">
            Link Loom dynamically reorganizes your bookmarks using artificial
            intelligence. If you want to freeze a particular backend structure
            before running a new organization job, create a Cloud Snapshot from
            the Link Loom browser extension. You can then restore your account
            to that exact cluster and assignment state.
          </p>
        </div>

        <div className="ll-panel max-w-4xl">
          <DashboardPanelHeader
            title="Cloud Snapshots"
            summary={`${count || 0} of 10 Cloud Snapshots`}
          />

          {!snapshots || snapshots.length === 0 ? (
            <div className="px-6 py-12 text-center text-ll-muted">
              <Save className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>You haven't saved any Cloud Snapshots yet.</p>
              <p className="text-sm mt-2">
                Open the Link Loom browser extension to create your first
                Cloud Snapshot.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-ll-border">
              {snapshots.map((snapshot: any) => (
                <li
                  key={snapshot.id}
                  className="ll-row flex min-h-[5.5rem] items-center justify-between gap-4 p-6"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h4 className="line-clamp-1 text-base font-medium text-ll-text">
                        {snapshot.name}
                      </h4>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-ll-muted">
                      <span>
                        Saved {formatRelativeTime(snapshot.created_at)}
                      </span>
                      <span className="rounded border border-ll-border bg-ll-card px-2 py-0.5 font-mono">
                        ID: {snapshot.id.split("-").pop()}
                      </span>
                    </div>
                  </div>

                  <div className="flex-shrink-0">
                    <CloudSnapshotActions
                      snapshotId={snapshot.id}
                      snapshotName={snapshot.name}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
