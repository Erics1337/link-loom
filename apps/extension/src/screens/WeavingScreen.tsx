import React from 'react';
import { ProgressBar } from '../components/ProgressBar';
import { PopOutButton } from '../components/PopOutButton';
import { useVersion } from '../hooks/useVersion';
import { Loader2 } from 'lucide-react';

interface WeavingScreenProps {
    progress: number;
    statusMessage?: string;
    statusDetail?: string;
    onCancel: () => void;
}

export const WeavingScreen: React.FC<WeavingScreenProps> = ({
    progress,
    statusMessage = "Analyzing bookmark graph and building clusters.",
    statusDetail,
    onCancel
}) => {
    const version = useVersion();
    return (
        <div className="app-shell">
            <div className="app-header">
                <div className="brand-lockup">
                    <img src="/icons/icon-48.png" alt="Link Loom" className="brand-icon" />
                    <div>
                        <p className="eyebrow">Processing</p>
                        <h1 className="brand-title">Link Loom</h1>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="badge">v {version}</span>
                    <PopOutButton />
                </div>
            </div>

            <section className="panel">
                <Loader2 size={26} className="text-accent" />
                <h2 className="screen-title mt-3">Building your map</h2>
                <p className="screen-copy mt-2">AI is grouping bookmarks, naming folders, and checking structure.</p>
            </section>

            <section className="card space-y-3">
                <div className="stat-row">
                    <span className="text-sm font-bold text-primary">Progress</span>
                    <span className="badge-count">{Math.round(progress)}%</span>
                </div>
                <ProgressBar progress={progress} />
                <div>
                    <p className="text-sm text-primary font-bold">{statusMessage}</p>
                    {statusDetail && <p className="text-xs text-secondary mt-1">{statusDetail}</p>}
                </div>
            </section>

            <div className="message mt-auto">
                Runs in background. Reopen popup anytime to check progress.
            </div>

            <button onClick={onCancel} className="btn btn-secondary text-danger">
                Cancel Processing
            </button>
        </div>
    );
};
