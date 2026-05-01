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
    onBack
}) => {
    const version = useVersion();
    const [expandAll, setExpandAll] = useState(false);
    const requirePro = (action: () => void) => {
        if (!isPremium) {
            onUpgrade();
            return;
        }
        action();
    };
    const { organized, total } = React.useMemo(() => {
        const countLeaves = (nodes: BookmarkNode[]): { organized: number; total: number } =>
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
                { organized: 0, total: 0 }
            );

        return countLeaves(clusters);
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
                    onClick={() => requirePro(() => void onAutoRename())}
                    disabled={isAutoRenaming}
                    title={isPremium ? 'Auto rename bookmarks' : 'Upgrade to Pro to auto rename bookmarks'}
                >
                    {isAutoRenaming ? 'Renaming...' : isPremium ? 'Auto rename' : 'Auto rename Pro'}
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
                        {organized < total ? `${organized} organized (${total} total)` : total}
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
                                title={isPremium ? 'Delete dead links' : 'Upgrade to Pro to delete dead links'}
                            >
                                {isDeletingDeadLinks ? 'Deleting...' : isPremium ? 'Delete all' : 'Delete all Pro'}
                            </button>
                        ) : (
                            <button
                                className="text-btn-danger"
                                onClick={() => requirePro(() => void onScanDeadLinks())}
                                disabled={isScanningDeadLinks}
                                title={isPremium ? 'Scan for dead links' : 'Upgrade to Pro to scan dead links'}
                            >
                                {isScanningDeadLinks ? 'Scanning...' : isPremium ? 'Scan' : 'Scan Pro'}
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
