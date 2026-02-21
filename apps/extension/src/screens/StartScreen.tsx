import React from 'react';
import { PopOutButton } from '../components/PopOutButton';

const WEB_APP_URL = (import.meta.env.VITE_WEB_APP_URL as string | undefined) || 'http://localhost:3000';

interface StartScreenProps {
    onStart: () => void;
    onOpenSettings: () => void;
    onOpenLogin: () => void;
    onOpenBackups: () => void;
    onSignOut: () => void;
    isLoggedIn: boolean;
    isPremium: boolean;
    accountEmail?: string | null;
}

export const StartScreen: React.FC<StartScreenProps> = ({
    onStart,
    onOpenSettings,
    onOpenLogin,
    onOpenBackups,
    onSignOut,
    isLoggedIn,
    isPremium,
    accountEmail
}) => {
    const onUpgrade = () => {
        window.open(`${WEB_APP_URL}/dashboard/billing`, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="flex flex-col items-center justify-center h-full p-4 text-center relative">
            <div className="absolute top-4 right-4 flex items-center gap-2">
                <span className="text-secondary text-xs">v 0.1</span>
                <PopOutButton />
            </div>

            <div className="flex items-center justify-center gap-3 mb-2">
                <img src="/icons/icon-48.png" alt="Logo" className="w-10 h-10" />
                <h1 className="text-3xl font-bold">Link Loom</h1>
            </div>
            <p className="mb-4 text-lg text-secondary">
                Organize your bookmarks<br />with AI clustering.
            </p>

            <button
                onClick={onStart}
                className="btn btn-primary w-full max-w-[200px] py-3 text-base font-medium transition-transform active:scale-95"
                style={{ maxWidth: '240px' }}
            >
                Organize Bookmarks
            </button>

            <button
                onClick={onOpenSettings}
                className="btn btn-secondary w-full max-w-[200px] mt-3"
                style={{ maxWidth: '240px' }}
            >
                Clustering Settings
            </button>

            <div className="card mt-4 w-full" style={{ maxWidth: '300px' }}>
                {isLoggedIn ? (
                    <div className="flex flex-col gap-2">
                         <div className="flex flex-col items-center justify-center text-center pb-2 border-b border-gray-700/50 mb-2">
                            <p className="text-xs text-secondary truncate w-full px-2">
                                {accountEmail || 'Logged in'}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${isPremium ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-300'}`}>
                                    {isPremium ? 'Lifetime Pro' : 'Free Tier'}
                                </span>
                            </div>
                        </div>
                        
                        {!isPremium && (
                            <button onClick={onUpgrade} className="btn w-full bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm border-0 mb-1">
                                Upgrade to Pro
                            </button>
                        )}

                        <button onClick={onOpenBackups} className="btn btn-secondary w-full text-sm">
                            Manage Backups
                        </button>
                        <button onClick={onSignOut} className="btn btn-secondary w-full text-sm">
                            Sign Out
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <p className="text-xs text-secondary">
                            Free mode allows up to 500 bookmarks. Log in to save backups.
                        </p>
                        <button onClick={onOpenLogin} className="btn btn-secondary w-full">
                            Log In / Sign Up
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
