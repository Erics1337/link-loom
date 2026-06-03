import React from 'react';
import { ProgressBar } from '../components/ProgressBar';
import { Loader2 } from 'lucide-react';
import { ScreenHeader } from './ScreenHeader';

interface WeavingScreenProps {
    progress: number;
    statusMessage?: string;
    statusDetail?: string;
    onCancel: () => void;
}

export const WeavingScreen: React.FC<WeavingScreenProps> = ({
    progress,
    statusMessage = 'Analyzing bookmark graph and building clusters.',
    statusDetail,
    onCancel
}) => {
    return (
        <div className="app-shell">
            <ScreenHeader eyebrow="Processing" title="Link Loom" />

            <section className="panel">
                <Loader2 size={26} className="text-accent" />
                <h2 className="screen-title mt-3">Building your map</h2>
                <p className="screen-copy mt-2">
                    AI is grouping bookmarks, naming folders, and checking
                    structure.
                </p>
            </section>

            <section className="card space-y-3">
                <div className="stat-row">
                    <span className="text-sm font-bold text-primary">
                        Progress
                    </span>
                    <span className="badge-count">{Math.round(progress)}%</span>
                </div>
                <ProgressBar progress={progress} />
                <div>
                    <p className="text-sm text-primary font-bold">
                        {statusMessage}
                    </p>
                    {statusDetail && (
                        <p className="text-xs text-secondary mt-1">
                            {statusDetail}
                        </p>
                    )}
                </div>
            </section>

            <div className="message mt-auto">
                Runs in background. Reopen popup anytime to check progress.
            </div>

            <button
                onClick={onCancel}
                className="btn btn-secondary text-danger"
            >
                Cancel Processing
            </button>
        </div>
    );
};
