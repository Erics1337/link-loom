import React, { useState } from 'react';
import { BookmarkTree, BookmarkNode } from '../components/BookmarkTree';
import { PopOutButton } from '../components/PopOutButton';

interface ResultsScreenProps {
    clusters: BookmarkNode[];
    stats: {
        duplicates: number;
        deadLinks: number;
    };
    onApply: () => void;
    onBack: () => void;
}

export const ResultsScreen: React.FC<ResultsScreenProps> = ({
    clusters,
    stats,
    onApply,
    onBack
}) => {
    const [expandAll, setExpandAll] = useState(false);
    const totalBookmarks = React.useMemo(() => {
        const countLeaves = (nodes: BookmarkNode[]): number =>
            nodes.reduce((sum, node) => {
                if (!node.children || node.children.length === 0) return sum + (node.url ? 1 : 0);
                return sum + countLeaves(node.children);
            }, 0);

        return countLeaves(clusters);
    }, [clusters]);

    return (
        <div className="flex flex-col h-full p-4 gap-4">
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
                    <span className="badge">v 0.1</span>
                    <PopOutButton />
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
                <button
                    onClick={() => setExpandAll(!expandAll)}
                    className="btn btn-secondary flex-1"
                >
                    {expandAll ? 'Collapse all' : 'Expand all'}
                </button>
                <button className="btn btn-secondary flex-1" disabled title="Not implemented yet">
                    Auto rename (Soon)
                </button>
            </div>

            {/* Tree View Card */}
            <div className="card flex-1 min-h-0 overflow-hidden flex flex-col p-0">
                <div className="p-2 border-b border-white-10 text-xs font-medium text-secondary uppercase tracking-wider">
                    Proposed Structure
                </div>
                <BookmarkTree nodes={clusters} defaultExpanded={expandAll} />
            </div>

            {/* Footer Stats & Actions */}
            <div className="flex flex-col gap-3">
                <div className="stat-row">
                    <span className="text-secondary text-sm">Total bookmarks</span>
                    <span className="badge-count">{totalBookmarks}</span>
                </div>
                <div className="stat-row">
                    <span className="text-secondary text-sm">Dead links</span>
                    <div className="flex items-center gap-2">
                        <span className="badge-count">{stats.deadLinks}</span>
                        <button className="text-btn-danger" disabled={stats.deadLinks === 0}>Delete all</button>
                    </div>
                </div>
                <div className="stat-row">
                    <span className="text-secondary text-sm">Duplicates</span>
                    <div className="flex items-center gap-2">
                        <span className="badge-count">{stats.duplicates}</span>
                        <button className="text-btn-danger" disabled={stats.duplicates === 0}>Delete all</button>
                    </div>
                </div>
                
                <div className="flex gap-3 mt-2">
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
