import React, { useState } from 'react';
import { BookmarkTree, BookmarkNode } from '../components/BookmarkTree';
import { PopOutButton } from '../components/PopOutButton';
import { useVersion } from '../hooks/useVersion';
import { Check } from 'lucide-react';

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
        <div className="app-shell" style={{ gap: 10, padding: 10 }}>
            <div className="app-header">
                <div className="brand-lockup">
                    <img src="/icons/icon-48.png" alt="Link Loom" className="brand-icon" />
                    <div>
                        <p className="eyebrow">Import preview</p>
                        <h1 className="brand-title">Structure</h1>
                    </div>
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
                <div className={`message ${message.kind === 'error' ? 'message-error' : 'message-success'}`}>
                    {message.text}
                </div>
            )}

            <div className="card flex-1 min-h-0 overflow-hidden flex flex-col p-0">
                <div className="p-2 border-b border-white-10 flex items-center justify-between">
                    <span className="eyebrow">Proposed Structure</span>
                    <span className="badge-count">{folderCount} folders</span>
                </div>
                <BookmarkTree nodes={nodes} defaultExpanded={expandAll} />
            </div>

            <div className="card">
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

            </div>

            <div className="grid" style={{ gridTemplateColumns: '0.7fr 1.3fr', gap: 8 }}>
                <button onClick={onBack} className="btn btn-secondary" disabled={isApplying}>Back</button>
                <button onClick={() => void onApply()} className="btn btn-primary" disabled={isApplying}>
                    {isApplying ? 'Applying...' : <><Check size={15} /> Apply Structure</>}
                </button>
            </div>
        </div>
    );
};
