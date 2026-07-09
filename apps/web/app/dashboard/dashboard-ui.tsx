import type { ReactNode } from "react";

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 0) {
    const aheadMs = -diffMs;
    const aheadHours = Math.floor(aheadMs / (1000 * 60 * 60));
    const aheadDays = Math.floor(aheadMs / (1000 * 60 * 60 * 24));
    if (aheadHours < 1) return "Very soon";
    if (aheadHours < 24) return `In ${aheadHours}h`;
    if (aheadDays < 7) return `In ${aheadDays}d`;
    return date.toLocaleDateString();
  }

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function DashboardTopbar({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="ll-topbar">
      {typeof title === "string" ? (
        <h1 className="text-xl font-semibold text-ll-text">{title}</h1>
      ) : (
        title
      )}
      {children}
    </header>
  );
}

export function DashboardPanelHeader({
  title,
  summary,
}: {
  title: ReactNode;
  summary: ReactNode;
}) {
  return (
    <div className="ll-panel-header">
      <h3 className="text-base font-semibold leading-6 text-ll-text">
        {title}
      </h3>
      <span className="text-sm text-ll-muted">{summary}</span>
    </div>
  );
}
