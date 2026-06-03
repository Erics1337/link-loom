import React from 'react';
import { PopOutButton } from '../components/PopOutButton';
import { useVersion } from '../hooks/useVersion';

interface ScreenHeaderProps {
    eyebrow: string;
    title: string;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
    eyebrow,
    title
}) => {
    const version = useVersion();

    return (
        <div className="app-header">
            <div className="brand-lockup">
                <img
                    src="/icons/icon-48.png"
                    alt="Link Loom"
                    className="brand-icon"
                />
                <div>
                    <p className="eyebrow">{eyebrow}</p>
                    <h1 className="brand-title">{title}</h1>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <span className="badge">v {version}</span>
                <PopOutButton />
            </div>
        </div>
    );
};
