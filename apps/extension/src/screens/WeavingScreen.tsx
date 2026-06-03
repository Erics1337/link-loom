import React from 'react';
import { ProgressBar } from '../components/ProgressBar';
import { Loader2 } from 'lucide-react';
import { ScreenHeader } from './ScreenHeader';

interface WeavingScreenProps {
    progress: number;
    eyebrow?: string;
    title?: string;
    description?: string;
    statusMessage?: string;
    statusDetail?: string;
    footerMessage?: string;
    onCancel?: () => void;
}

export const WeavingScreen: React.FC<WeavingScreenProps> = ({
    progress,
    eyebrow = 'Processing',
    title = 'Building your map',
    description = 'AI is grouping bookmarks, naming folders, and checking structure.',
    statusMessage = 'Analyzing bookmark graph and building clusters.',
    statusDetail,
    footerMessage = 'Runs in background. Reopen popup anytime to check progress.',
    onCancel
}) => {
    return (
        <div className="app-shell">
            <ScreenHeader eyebrow={eyebrow} title="Link Loom" />

            <section className="panel">
                <Loader2 size={26} className="text-accent" />
                <h2 className="screen-title mt-3">{title}</h2>
                <p className="screen-copy mt-2">{description}</p>
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
                {footerMessage}
            </div>

            {onCancel && (
                <button
                    onClick={onCancel}
                    className="btn btn-secondary text-danger"
                >
                    Cancel Processing
                </button>
            )}
        </div>
    );
};
