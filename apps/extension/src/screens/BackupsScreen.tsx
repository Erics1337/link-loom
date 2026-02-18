import React from 'react';
import { BookmarkBackupSnapshot } from '../hooks/useBookmarkWeaver';

interface BackupsScreenProps {
    backups: BookmarkBackupSnapshot[];
    onBack: () => void;
    onSaveCurrent: () => Promise<void>;
    onRestore: (backupId: string) => Promise<void>;
    onDelete: (backupId: string) => Promise<void>;
}

const formatTimestamp = (timestamp: string) => {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return 'Unknown date';
    return parsed.toLocaleString();
};

export const BackupsScreen: React.FC<BackupsScreenProps> = ({
    backups,
    onBack,
    onSaveCurrent,
    onRestore,
    onDelete
}) => {
    const [workingId, setWorkingId] = React.useState<string | null>(null);
    const [isSavingCurrent, setIsSavingCurrent] = React.useState(false);
    const [message, setMessage] = React.useState<string | null>(null);

    const handleSaveCurrent = async () => {
        setIsSavingCurrent(true);
        setMessage(null);
        try {
            await onSaveCurrent();
            setMessage('Saved current bookmark state.');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Failed to save backup.');
        } finally {
            setIsSavingCurrent(false);
        }
    };

    const handleRestore = async (backupId: string) => {
        setWorkingId(backupId);
        setMessage(null);
        try {
            await onRestore(backupId);
            setMessage('Backup restored into a new folder in Other Bookmarks.');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Failed to restore backup.');
        } finally {
            setWorkingId(null);
        }
    };

    const handleDelete = async (backupId: string) => {
        setWorkingId(backupId);
        setMessage(null);
        try {
            await onDelete(backupId);
            setMessage('Backup deleted.');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Failed to delete backup.');
        } finally {
            setWorkingId(null);
        }
    };

    return (
        <div className="flex flex-col h-full p-4 gap-4">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold">Bookmark Backups</h1>
                    <p className="text-xs text-secondary mt-1">
                        Save current bookmarks here, or auto-save when applying changes while logged in.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={handleSaveCurrent} className="btn btn-primary" disabled={isSavingCurrent}>
                        {isSavingCurrent ? 'Saving...' : 'Save Current'}
                    </button>
                    <button onClick={onBack} className="btn btn-secondary">Back</button>
                </div>
            </div>

            {message && (
                <div className="card">
                    <p className="text-xs text-secondary">{message}</p>
                </div>
            )}

            <div className="card flex-1 min-h-0 overflow-y-auto">
                {backups.length === 0 && (
                    <p className="text-sm text-secondary">No backups yet. Click Save Current or apply changes while logged in.</p>
                )}

                {backups.map((backup) => {
                    const summary = backup.summary || { folders: 0, bookmarks: 0 };
                    const isWorking = workingId === backup.id;
                    return (
                        <div key={backup.id} className="stat-row border-b border-white-10" style={{ padding: '10px 0' }}>
                            <div>
                                <div className="text-sm text-primary">{formatTimestamp(backup.createdAt)}</div>
                                <div className="text-xs text-secondary">
                                    {summary.folders} folders • {summary.bookmarks} bookmarks
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handleRestore(backup.id)}
                                    className="btn btn-secondary"
                                    disabled={isWorking}
                                >
                                    Restore
                                </button>
                                <button
                                    onClick={() => handleDelete(backup.id)}
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
