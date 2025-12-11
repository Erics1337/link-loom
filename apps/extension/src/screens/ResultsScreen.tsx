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

export const ResultsScreen: React.FC<ResultsScreenProps> = ({ clusters, stats, onApply, onBack }) => {
    const [expandAll, setExpandAll] = useState(false);

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
                <button className="btn btn-secondary flex-1">
                    Auto rename
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
                    <span className="text-secondary text-sm">Dead links</span>
                    <button className="text-btn-danger">Delete all</button>
                </div>
                <div className="stat-row">
                    <span className="text-secondary text-sm">Duplicates</span>
                    <div className="flex items-center gap-2">
                        <span className="badge-count">{stats.duplicates}</span>
                        <button className="text-btn-danger">Delete all</button>
                    </div>
                </div>
                
                <div className="flex gap-3 mt-2">
                    <button onClick={onBack} className="btn btn-secondary">
                        Back
                    </button>
                    <button onClick={onApply} className="btn btn-primary flex-1">
                        Apply Changes
                    </button>
                </div>
            </div>
        </div>
    );
};
