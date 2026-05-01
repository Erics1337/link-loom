import React, { useState } from 'react';
import { BookmarkTree, BookmarkNode } from '../components/BookmarkTree';
import { PopOutButton } from '../components/PopOutButton';
import { useVersion } from '../hooks/useVersion';

interface ImportStructureScreenProps {
    fileName: string;
    nodes: BookmarkNode[];
    bookmarkCount: number;
    folderCount: number;
    onApply: () => Promise<void> | void;
    onBack: () => void;
    isApplying: boolean;
    message?: {
        kind: 'success' | 'error';
        text: string;
    } | null;
}

export const ImportStructureScreen: React.FC<ImportStructureScreenProps> = ({
    fileName,
    nodes,
    bookmarkCount,
    folderCount,
    onApply,
    onBack,
    isApplying,
    message,
}) => {
    const version = useVersion();
    const [expandAll, setExpandAll] = useState(true);

    return (
        <div className="flex flex-col h-full p-2 gap-2">
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <img src="/icons/icon-48.png" alt="Logo" className="w-6 h-6" />
                        <h1 className="text-xl font-bold text-gradient">Link Loom</h1>
                    </div>
                    <p className="text-xs text-secondary mt-1">
                        Preview imported bookmark structure.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="badge">v {version}</span>
                    <PopOutButton />
                </div>
            </div>

            <div className="flex gap-2">
                <button
                    onClick={() => setExpandAll(!expandAll)}
                    className="btn btn-secondary flex-1"
                >
                    {expandAll ? 'Collapse all' : 'Expand all'}
                </button>
            </div>

            {message && (
                <div
                    className="card"
                    style={{
                        borderColor:
                            message.kind === 'error'
                                ? 'rgba(239, 68, 68, 0.3)'
                                : 'rgba(34, 197, 94, 0.3)',
                    }}
                >
                    <p
                        className="text-xs"
                        style={{
                            color: message.kind === 'error' ? '#fca5a5' : '#86efac',
                        }}
                    >
                        {message.text}
                    </p>
                </div>
            )}

            <div className="card flex-1 min-h-0 overflow-hidden flex flex-col p-0">
                <div className="p-1 border-b border-white-10 text-xs font-medium text-secondary uppercase tracking-wider">
                    Proposed Structure
                </div>
                <BookmarkTree nodes={nodes} defaultExpanded={expandAll} />
            </div>

            <div className="flex flex-col gap-2">
                <div className="stat-row">
                    <span className="text-secondary text-sm">Import file</span>
                    <span className="badge-count">{fileName}</span>
                </div>
                <div className="stat-row">
                    <span className="text-secondary text-sm">Bookmarks</span>
                    <span className="badge-count">{bookmarkCount}</span>
                </div>
                <div className="stat-row">
                    <span className="text-secondary text-sm">Folders</span>
                    <span className="badge-count">{folderCount}</span>
                </div>

                <div className="flex gap-2 mt-1">
                    <button onClick={onBack} className="btn btn-secondary flex-1" disabled={isApplying}>
                        Back
                    </button>
                    <button onClick={() => void onApply()} className="btn btn-primary flex-1" disabled={isApplying}>
                        {isApplying ? 'Applying...' : 'Apply Structure'}
                    </button>
                </div>
            </div>
        </div>
    );
};
