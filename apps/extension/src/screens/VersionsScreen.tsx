import React from 'react';
import { BookmarkStructureVersion } from '../hooks/useBookmarkWeaver';

interface VersionsScreenProps {
    versions: BookmarkStructureVersion[];
    onBack: () => void;
    onRestore: (versionId: string) => Promise<void>;
    onDelete: (versionId: string) => Promise<void>;
}

const formatTimestamp = (timestamp: string) => {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return 'Unknown date';
    return parsed.toLocaleString();
};

export const VersionsScreen: React.FC<VersionsScreenProps> = ({
    versions,
    onBack,
    onRestore,
    onDelete
}) => {
    const [workingId, setWorkingId] = React.useState<string | null>(null);
    const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

    const handleRestore = async (versionId: string) => {
        try {
            setWorkingId(versionId);
            setErrorMessage(null);
            await onRestore(versionId);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Failed to restore version.');
        } finally {
            setWorkingId(null);
        }
    };

    const handleDelete = async (versionId: string) => {
        try {
            setWorkingId(versionId);
            setErrorMessage(null);
            await onDelete(versionId);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Failed to delete version.');
        } finally {
            setWorkingId(null);
        }
    };

    return (
        <div className="flex flex-col h-full p-4 gap-4">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold">Structure Versions</h1>
                    <p className="text-xs text-secondary mt-1">
                        Restore or delete saved bookmark structure snapshots.
                    </p>
                </div>
                <button onClick={onBack} className="btn btn-secondary">
                    Back
                </button>
            </div>

            {errorMessage && (
                <div className="card">
                    <p className="text-xs text-secondary">{errorMessage}</p>
                </div>
            )}

            <div className="card flex-1 min-h-0 overflow-y-auto">
                {versions.length === 0 && (
                    <p className="text-sm text-secondary">No saved versions yet.</p>
                )}

                {versions.map((version) => {
                    const isWorking = workingId === version.id;
                    const summary = version.summary || { folders: 0, bookmarks: 0 };
                    return (
                        <div key={version.id} className="stat-row border-b border-white-10" style={{ padding: '10px 0' }}>
                            <div>
                                <div className="text-sm text-primary">{formatTimestamp(version.createdAt)}</div>
                                <div className="text-xs text-secondary">
                                    {summary.folders} folders • {summary.bookmarks} bookmarks
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handleRestore(version.id)}
                                    className="btn btn-secondary"
                                    disabled={isWorking}
                                >
                                    Restore
                                </button>
                                <button
                                    onClick={() => handleDelete(version.id)}
                                    className="text-btn-danger"
                                    disabled={isWorking}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
