import React from 'react';
import { CloudSnapshot } from '../hooks/useBookmarkWeaver';
import { ArrowLeft, Save } from 'lucide-react';
import { formatTimestamp, useWorkingMessage } from './screenUtils';

interface CloudSnapshotsScreenProps {
    snapshots: CloudSnapshot[];
    onBack: () => void;
    onSaveCurrent: () => Promise<void>;
    onRestore: (snapshotId: string) => Promise<void>;
    onDelete: (snapshotId: string) => Promise<void>;
}

export const CloudSnapshotsScreen: React.FC<CloudSnapshotsScreenProps> = ({
    snapshots,
    onBack,
    onSaveCurrent,
    onRestore,
    onDelete
}) => {
    const { workingId, message, setMessage, runWithWorkingId } =
        useWorkingMessage();
    const [isSavingCurrent, setIsSavingCurrent] = React.useState(false);

    const handleSaveCurrent = async () => {
        setIsSavingCurrent(true);
        setMessage(null);
        try {
            await onSaveCurrent();
            setMessage('Saved Cloud Snapshot.');
        } catch (error) {
            setMessage(
                error instanceof Error
                    ? error.message
                    : 'Failed to save Cloud Snapshot.'
            );
        } finally {
            setIsSavingCurrent(false);
        }
    };

    const handleRestore = async (snapshotId: string) => {
        await runWithWorkingId(snapshotId, () => onRestore(snapshotId), {
            success: 'Cloud Snapshot restored successfully.',
            failure: 'Failed to restore Cloud Snapshot.'
        });
    };

    const handleDelete = async (snapshotId: string) => {
        await runWithWorkingId(snapshotId, () => onDelete(snapshotId), {
            success: 'Cloud Snapshot deleted.',
            failure: 'Failed to delete Cloud Snapshot.'
        });
    };

    return (
        <div className="app-shell">
            <div className="app-header">
                <button onClick={onBack} className="btn-icon" title="Back">
                    <ArrowLeft size={18} />
                </button>
                <div className="flex-1">
                    <p className="eyebrow">Cloud Snapshots</p>
                    <h1 className="screen-title">Cloud Snapshots</h1>
                </div>
            </div>

            {message && <div className="message">{message}</div>}

            <button
                onClick={handleSaveCurrent}
                className="btn btn-primary"
                disabled={isSavingCurrent}
            >
                <Save size={15} />{' '}
                {isSavingCurrent ? 'Saving...' : 'Save Cloud Snapshot'}
            </button>

            <div className="card flex-1 min-h-0 overflow-y-auto">
                {snapshots.length === 0 && (
                    <div className="message">
                        No Cloud Snapshots yet. Save the current backend
                        structure before applying major folder changes.
                    </div>
                )}

                {snapshots.map((snapshot) => {
                    const summary = snapshot.summary || {
                        folders: 0,
                        bookmarks: 0
                    };
                    const isWorking = workingId === snapshot.id;
                    return (
                        <div
                            key={snapshot.id}
                            className="border-b border-white-10"
                            style={{ padding: '12px 0' }}
                        >
                            <div className="stat-row">
                                <div className="min-h-0">
                                    <div
                                        className="text-sm font-bold text-primary truncate"
                                        title={snapshot.name}
                                    >
                                        {snapshot.name}
                                    </div>
                                    <div className="text-xs text-secondary mt-0.5">
                                        {formatTimestamp(snapshot.createdAt)}
                                    </div>
                                </div>
                                <span className="badge-count">
                                    {summary.folders} folders
                                </span>
                            </div>
                            <div className="stat-row mt-2">
                                <div className="text-xs text-secondary">
                                    Ready to restore
                                </div>
                                <span className="text-xs text-secondary">
                                    {summary.bookmarks} bookmarks
                                </span>
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                                <button
                                    onClick={() => handleRestore(snapshot.id)}
                                    className="btn btn-secondary flex-1"
                                    disabled={isWorking}
                                >
                                    Restore Cloud Snapshot
                                </button>
                                <button
                                    onClick={() => handleDelete(snapshot.id)}
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
