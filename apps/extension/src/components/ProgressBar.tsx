import React from 'react';

interface ProgressBarProps {
    progress: number; // 0 to 100
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress }) => {
    return (
        <div className="w-full rounded-full overflow-hidden" style={{ height: 10, background: 'var(--bg-tertiary)' }}>
            <div
                className="h-full transition-all duration-500 ease-out"
                style={{
                    width: `${Math.max(5, Math.min(100, progress))}%`,
                    background: 'linear-gradient(90deg, var(--accent-strong), var(--primary-color))',
                    borderRadius: 'inherit'
                }}
            />
        </div>
    );
};
