import React, { useState } from 'react';
import { BookmarkTree, BookmarkNode } from '../components/BookmarkTree';
import { PopOutButton } from '../components/PopOutButton';
import { useVersion } from '../hooks/useVersion';
import { Check, Settings, Sparkles } from 'lucide-react';

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
        <div className="app-shell" style={{ gap: 10, padding: 10 }}>
            <div className="app-header">
                <div className="brand-lockup">
                    <img src="/icons/icon-48.png" alt="Link Loom" className="brand-icon" />
                    <div>
                        <p className="eyebrow">Review structure</p>
                        <h1 className="brand-title">Results</h1>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="badge">v {version}</span>
                    <PopOutButton />
                </div>
            </div>

            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 38px', gap: 8 }}>
                <button
                    onClick={() => setExpandAll(!expandAll)}
                    className="btn btn-secondary"
                >
                    {expandAll ? 'Collapse all' : 'Expand all'}
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={() => requirePro(() => void onAutoRename())}
                    disabled={isAutoRenaming}
                    title={isPremium ? 'Auto rename bookmarks' : 'Upgrade to Pro to auto rename bookmarks'}
                >
                    {isAutoRenaming ? 'Renaming...' : isPremium ? 'Auto rename' : 'Rename Pro'}
                </button>
                <button className="btn-icon" onClick={onOpenSettings} title="Settings">
                    <Settings size={17} />
                </button>
            </div>

            <div className="card flex-1 min-h-0 overflow-hidden flex flex-col p-0">
                <div className="p-2 border-b border-white-10 flex items-center justify-between">
                    <span className="eyebrow">Proposed Structure</span>
                    <span className="badge-count">
                        {organized < total ? `${organized}/${total}` : total}
                    </span>
                </div>
                <BookmarkTree nodes={clusters} defaultExpanded={expandAll} />
            </div>

            <div className="card space-y-1">
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
            </div>

            <div className="grid" style={{ gridTemplateColumns: '0.7fr 1.3fr', gap: 8 }}>
                <button onClick={onBack} className="btn btn-secondary">Back</button>
                <button onClick={onApply} className="btn btn-primary">
                    <Check size={15} /> Apply Changes
                </button>
            </div>
            {!isPremium && <p className="text-xs text-secondary"><Sparkles size={12} /> Pro unlocks rename and dead-link tools.</p>}
        </div>
    );
};
