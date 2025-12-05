import React from 'react';

interface ProgressBarProps {
    progress: number; // 0 to 100
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress }) => {
    return (
        <div className="w-full h-4 bg-secondary rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
            <div
                className="h-full transition-all duration-500 ease-out"
                style={{
                    width: `${Math.max(5, Math.min(100, progress))}%`,
                    background: 'var(--primary-gradient)',
                    borderRadius: 'inherit'
                }}
            />
        </div>
    );
};
