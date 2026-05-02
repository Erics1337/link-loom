import React from 'react';
import { BookmarkBackupSnapshot } from '../hooks/useBookmarkWeaver';
import { ArrowLeft, Save } from 'lucide-react';

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
            setMessage('Structure snapshot restored successfully.');
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
        <div className="app-shell">
            <div className="app-header">
                <button onClick={onBack} className="btn-icon" title="Back">
                    <ArrowLeft size={18} />
                </button>
                <div className="flex-1">
                    <p className="eyebrow">Backups</p>
                    <h1 className="screen-title">Snapshots</h1>
                </div>
            </div>

            {message && (
                <div className="message">{message}</div>
            )}

            <button onClick={handleSaveCurrent} className="btn btn-primary" disabled={isSavingCurrent}>
                <Save size={15} /> {isSavingCurrent ? 'Saving...' : 'Save Current Structure'}
            </button>

            <div className="card flex-1 min-h-0 overflow-y-auto">
                {backups.length === 0 && (
                    <div className="message">
                        No snapshots yet. Save current structure before applying major folder changes.
                    </div>
                )}

                {backups.map((backup) => {
                    const summary = backup.summary || { folders: 0, bookmarks: 0 };
                    const isWorking = workingId === backup.id;
                    return (
                        <div key={backup.id} className="border-b border-white-10" style={{ padding: '12px 0' }}>
                            <div className="stat-row">
                                <div className="min-h-0">
                                    <div className="text-sm font-bold text-primary truncate" title={backup.name}>{backup.name}</div>
                                    <div className="text-xs text-secondary mt-0.5">{formatTimestamp(backup.createdAt)}</div>
                                </div>
                                <span className="badge-count">{summary.folders} folders</span>
                            </div>
                            <div className="stat-row mt-2">
                                <div className="text-xs text-secondary">Ready to restore</div>
                                <span className="text-xs text-secondary">{summary.bookmarks} bookmarks</span>
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                                <button
                                    onClick={() => handleRestore(backup.id)}
                                    className="btn btn-secondary flex-1"
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
