import React, { useState } from 'react';
import { BookmarkTree, BookmarkNode } from '../components/BookmarkTree';
import { PopOutButton } from '../components/PopOutButton';
import { useVersion } from '../hooks/useVersion';

interface ResultsScreenProps {
    clusters: BookmarkNode[];
    stats: {
        duplicates: number;
        deadLinks: number;
    };
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
}

export const ResultsScreen: React.FC<ResultsScreenProps> = ({
    clusters,
    stats,
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
    onBack
}) => {
    const version = useVersion();
    const [expandAll, setExpandAll] = useState(false);
    const { organizedCount, totalBookmarks } = React.useMemo(() => {
        let orgCount = 0;
        let totalCount = 0;
        let foundSeparator = false;

        const countLeaves = (nodes: BookmarkNode[]): number => {
            return nodes.reduce((sum, node) => {
                if (node.isSeparator) return sum;
                if (!node.children || node.children.length === 0) return sum + (node.url ? 1 : 0);
                return sum + countLeaves(node.children);
            }, 0);
        };

        for (const node of clusters) {
            if (node.isSeparator) {
                foundSeparator = true;
                continue;
            }
            const leaves = countLeaves([node]);
            totalCount += leaves;
            if (!foundSeparator) {
                orgCount += leaves;
            }
        }

        return { organizedCount: orgCount, totalBookmarks: totalCount };
    }, [clusters]);

    return (
        <div className="flex flex-col h-full p-2 gap-2">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <img src="/icons/icon-48.png" alt="Logo" className="w-6 h-6" />
                        <h1 className="text-xl font-bold text-gradient">Link Loom</h1>
                    </div>
                    <p className="text-xs text-secondary mt-1">
                        Organize your bookmarks with AI clustering.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="badge">v {version}</span>
                    <PopOutButton />
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
                <button
                    onClick={() => setExpandAll(!expandAll)}
                    className="btn btn-secondary flex-1"
                >
                    {expandAll ? 'Collapse all' : 'Expand all'}
                </button>
                <button
                    className="btn btn-secondary flex-1"
                    onClick={() => void onAutoRename()}
                    disabled={isAutoRenaming}
                >
                    {isAutoRenaming ? 'Renaming...' : 'Auto rename'}
                </button>
                <button className="btn btn-secondary flex-1" onClick={onOpenSettings}>
                    Settings
                </button>
            </div>

            {/* Tree View Card */}
            <div className="card flex-1 min-h-0 overflow-hidden flex flex-col p-0">
                <div className="p-1 border-b border-white-10 text-xs font-medium text-secondary uppercase tracking-wider">
                    Proposed Structure
                </div>
                <BookmarkTree nodes={clusters} defaultExpanded={expandAll} />
            </div>

            {/* Footer Stats & Actions */}
            <div className="flex flex-col gap-2">
                <div className="stat-row">
                    <span className="text-secondary text-sm">Total bookmarks</span>
                    <span className="badge-count">
                        {organizedCount < totalBookmarks ? `${organizedCount} organized (${totalBookmarks} total)` : totalBookmarks}
                    </span>
                </div>
                <div className="stat-row">
                    <span className="text-secondary text-sm">Dead links</span>
                    <div className="flex items-center gap-2">
                        <span className="badge-count">{stats.deadLinks}</span>
                        {stats.deadLinks > 0 ? (
                            <button
                                className="text-btn-danger"
                                onClick={() => void onDeleteDeadLinks()}
                                disabled={isDeletingDeadLinks}
                            >
                                {isDeletingDeadLinks ? 'Deleting...' : 'Delete all'}
                            </button>
                        ) : (
                            <button
                                className="text-btn-danger"
                                onClick={() => void onScanDeadLinks()}
                                disabled={isScanningDeadLinks}
                            >
                                {isScanningDeadLinks ? 'Scanning...' : 'Scan'}
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
                            {isDeletingDuplicates ? 'Deleting...' : 'Delete all'}
                        </button>
                    </div>
                </div>
                
                <div className="flex gap-2 mt-1">
                    <button onClick={onBack} className="btn btn-secondary flex-1">
                        Back
                    </button>
                    <button onClick={onApply} className="btn btn-primary flex-1">
                        Apply Changes
                    </button>
                </div>
                <p className="text-xs text-secondary">
                    Backups are managed in the main screen and require login.
                </p>
            </div>
        </div>
    );
};
