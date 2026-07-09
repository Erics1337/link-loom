import React, { useState } from "react";
import { BookmarkTree, BookmarkNode } from "../components/BookmarkTree";
import { Check, Search, Settings, Sparkles, X } from "lucide-react";
import { BookmarkSearchResult } from "../lib/structureClient";
import { ScreenHeader } from "./ScreenHeader";

interface ResultsScreenProps {
  clusters: BookmarkNode[];
  stats: {
    duplicates: number;
    deadLinks: number;
  };
  isPremium: boolean;
  onUpgrade: () => void;
  onAutoRename: () => Promise<void> | void;
  isAutoRenaming: boolean;
  onOpenSettings: () => void;
  onDeleteDuplicates: () => Promise<void> | void;
  onDeleteDeadLinks: () => Promise<void> | void;
  onScanDeadLinks: () => Promise<string[]> | void;
  isDeletingDuplicates: boolean;
  isDeletingDeadLinks: boolean;
  isScanningDeadLinks: boolean;
  onApply: () => void;
  onBack: () => void;
  onSearch: (query: string) => Promise<BookmarkSearchResult[]>;
  onRenameNode: (nodeId: string, nextTitle: string) => void;
  onMoveBookmark: (bookmarkId: string, targetFolderId: string) => void;
  backupEnabled: boolean;
  recoveryCard?: React.ReactNode;
}

export const ResultsScreen: React.FC<ResultsScreenProps> = ({
  clusters,
  stats,
  isPremium,
  onUpgrade,
  onAutoRename,
  isAutoRenaming,
  onOpenSettings,
  onDeleteDuplicates,
  onDeleteDeadLinks,
  onScanDeadLinks,
  isDeletingDuplicates,
  isDeletingDeadLinks,
  isScanningDeadLinks,
  onApply,
  onBack,
  onSearch,
  onRenameNode,
  onMoveBookmark,
  backupEnabled,
  recoveryCard,
}) => {
  const [expandAll, setExpandAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    BookmarkSearchResult[] | null
  >(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const runSearch = async () => {
    const query = searchQuery.trim();
    if (!query || isSearching) return;
    setIsSearching(true);
    setSearchError(null);
    setSearchResults(null);
    try {
      setSearchResults(await onSearch(query));
    } catch (error) {
      setSearchResults(null);
      setSearchError(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults(null);
    setSearchError(null);
  };
  const requirePro = (action: () => void) => {
    if (!isPremium) {
      onUpgrade();
      return;
    }
    action();
  };
  const { organized, total } = React.useMemo(() => {
    const countLeaves = (
      nodes: BookmarkNode[],
    ): { organized: number; total: number } =>
      nodes.reduce(
        (sum, node) => {
          if (node.isSeparator) return sum;
          if (!node.children || node.children.length === 0) {
            if (!node.url) return sum;
            return {
              organized: sum.organized + (node.isOverflow ? 0 : 1),
              total: sum.total + 1,
            };
          }

          const childCounts = countLeaves(node.children);
          return {
            organized: sum.organized + childCounts.organized,
            total: sum.total + childCounts.total,
          };
        },
        { organized: 0, total: 0 },
      );

    return countLeaves(clusters);
  }, [clusters]);

  return (
    <div className="app-shell" style={{ gap: 10, padding: 10 }}>
      <ScreenHeader eyebrow="Review structure" title="Results" />

      {recoveryCard}

      <div
        className="grid"
        style={{ gridTemplateColumns: "1fr 1fr 38px", gap: 8 }}
      >
        <button
          onClick={() => setExpandAll(!expandAll)}
          className="btn btn-secondary"
        >
          {expandAll ? "Collapse all" : "Expand all"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => requirePro(() => void onAutoRename())}
          disabled={isAutoRenaming}
          title={
            isPremium
              ? "Auto rename bookmarks"
              : "Upgrade to Pro to auto rename bookmarks"
          }
        >
          {isAutoRenaming
            ? "Renaming..."
            : isPremium
              ? "Auto rename"
              : "Rename Pro"}
        </button>
        <button className="btn-icon" onClick={onOpenSettings} title="Settings">
          <Settings size={17} />
        </button>
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch();
        }}
      >
        <input
          type="text"
          className="field flex-1"
          placeholder="Search bookmarks by meaning…"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        <button
          type="submit"
          className="btn-icon"
          disabled={isSearching || !searchQuery.trim()}
          title="Semantic search"
        >
          <Search size={16} />
        </button>
        {(searchResults !== null || searchError) && (
          <button
            type="button"
            className="btn-icon"
            onClick={clearSearch}
            title="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </form>
      {searchError && <p className="text-xs text-secondary">{searchError}</p>}

      <div className="card flex-1 min-h-0 overflow-hidden flex flex-col p-0">
        <div className="p-2 border-b border-white-10 flex items-center justify-between">
          <span className="eyebrow">
            {searchResults !== null ? "Search Results" : "Proposed Structure"}
          </span>
          <span className="badge-count">
            {searchResults !== null
              ? searchResults.length
              : organized < total
                ? `${organized}/${total}`
                : total}
          </span>
        </div>
        {searchResults !== null ? (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {isSearching ? (
              <p className="text-sm text-secondary">Searching…</p>
            ) : searchResults.length === 0 ? (
              <p className="text-sm text-secondary">
                No matching bookmarks found.
              </p>
            ) : (
              searchResults.map((result) => (
                <a
                  key={result.id}
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="tree-node block"
                  title={result.url}
                >
                  <span className="block text-sm truncate">
                    {result.title || result.url}
                  </span>
                  <span className="block text-xs text-secondary truncate">
                    {result.description || result.url}
                  </span>
                </a>
              ))
            )}
          </div>
        ) : (
          <BookmarkTree
            nodes={clusters}
            defaultExpanded={expandAll}
            onRenameNode={onRenameNode}
            onMoveBookmark={onMoveBookmark}
          />
        )}
      </div>

      <div className="card space-y-1">
        <div className="stat-row">
          <span className="text-secondary text-sm">Total bookmarks</span>
          <span className="badge-count">
            {organized < total
              ? `${organized} organized (${total} total)`
              : total}
          </span>
        </div>
        <div className="stat-row">
          <span className="text-secondary text-sm">Dead links</span>
          <div className="flex items-center gap-2">
            <span className="badge-count">{stats.deadLinks}</span>
            {stats.deadLinks > 0 ? (
              <button
                className="text-btn-danger"
                onClick={() => requirePro(() => void onDeleteDeadLinks())}
                disabled={isDeletingDeadLinks}
                title={
                  isPremium
                    ? "Delete dead links"
                    : "Upgrade to Pro to delete dead links"
                }
              >
                {isDeletingDeadLinks
                  ? "Deleting..."
                  : isPremium
                    ? "Delete all"
                    : "Delete all Pro"}
              </button>
            ) : (
              <button
                className="text-btn-danger"
                onClick={() => requirePro(() => void onScanDeadLinks())}
                disabled={isScanningDeadLinks}
                title={
                  isPremium
                    ? "Scan for dead links"
                    : "Upgrade to Pro to scan dead links"
                }
              >
                {isScanningDeadLinks
                  ? "Scanning..."
                  : isPremium
                    ? "Scan"
                    : "Scan Pro"}
              </button>
            )}
          </div>
        </div>
        <div className="stat-row">
          <span className="text-secondary text-sm">Duplicates</span>
          <div className="flex items-center gap-2">
            <span className="badge-count">{stats.duplicates}</span>
            <button
              className="text-btn-danger"
              onClick={() => void onDeleteDuplicates()}
              disabled={stats.duplicates === 0 || isDeletingDuplicates}
            >
              {isDeletingDuplicates ? "Deleting..." : "Delete all"}
            </button>
          </div>
        </div>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: "0.7fr 1.3fr", gap: 8 }}
      >
        <button onClick={onBack} className="btn btn-secondary">
          Back
        </button>
        <button onClick={onApply} className="btn btn-primary">
          <Check size={15} /> Apply Changes
        </button>
      </div>
      <p className="text-xs text-secondary">
        {backupEnabled
          ? "A Cloud Snapshot will be saved before applying — restore anytime from Cloud Snapshots."
          : "Sign in to save Cloud Snapshots before applying."}
      </p>
      {!isPremium && (
        <p className="text-xs text-secondary">
          <Sparkles size={12} /> Pro unlocks rename and dead-link tools.
        </p>
      )}
    </div>
  );
};
