import React, { useState } from 'react';
import { BookmarkTree, BookmarkNode } from '../components/BookmarkTree';

interface ResultsScreenProps {
    clusters: BookmarkNode[];
    stats: {
        duplicates: number;
        deadLinks: number;
    };
    onApply: () => void;
    onBack: () => void;
}

export const ResultsScreen: React.FC<ResultsScreenProps> = ({ clusters, stats, onApply, onBack }) => {
    const [expandAll, setExpandAll] = useState(false);

    return (
        <div className="flex flex-col h-full p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-1">
                <h1 className="text-2xl font-bold">Link Loom</h1>
                <span className="px-2 py-1 text-xs font-medium text-purple-200 bg-purple-900/50 rounded-full border border-purple-500/30">
                    v 0.1
                </span>
            </div>
            <p className="mb-4 text-sm text-secondary">
                Organize your bookmarks with AI clustering.
            </p>

            {/* Actions */}
            <div className="flex gap-3 mb-4">
                <button
                    onClick={() => setExpandAll(!expandAll)}
                    className="flex-1 btn bg-white/5 hover:bg-white/10 text-sm py-2"
                >
                    {expandAll ? 'Collapse all' : 'Expand all'}
                </button>
                <button className="flex-1 btn bg-white/5 hover:bg-white/10 text-sm py-2">
                    Auto rename folders
                </button>
            </div>

            {/* Tree View Card */}
            <div className="flex-1 overflow-hidden card mb-4 flex flex-col">
                <BookmarkTree nodes={clusters} defaultExpanded={expandAll} />
            </div>

            {/* Footer Stats */}
            <div className="space-y-3 mb-4">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-secondary">Dead links</span>
                    <button className="text-secondary hover:text-white text-xs">Delete all</button>
                </div>
                <div className="flex items-center justify-between text-sm">
                    <span className="text-secondary">Duplicates</span>
                    <div className="flex items-center gap-4">
                        <span className="font-medium">{stats.duplicates}</span>
                        <button className="text-secondary hover:text-white text-xs">Delete all</button>
                    </div>
                </div>
            </div>

            {/* Apply Button */}
            <div className="flex gap-3">
                <button
                    onClick={onBack}
                    className="btn w-1/3 bg-white/5 hover:bg-white/10"
                >
                    Back
                </button>
                <button
                    onClick={onApply}
                    className="btn btn-primary flex-1 py-3 text-base font-medium"
                >
                    Apply
                </button>
            </div>
        </div>
    );
};
