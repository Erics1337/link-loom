import React from 'react';
import { PopOutButton } from '../components/PopOutButton';

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
            <p className="mb-8 text-lg text-secondary">
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
                        <p className="text-xs text-secondary">
                            Logged in as {accountEmail || 'your account'}
                        </p>
                        <p className="text-xs text-secondary">
                            Plan: {isPremium ? 'Pro (Unlimited)' : 'Free (Up to 500 bookmarks)'}
                        </p>
                        <button onClick={onOpenBackups} className="btn btn-secondary w-full">
                            Manage Backups
                        </button>
                        <button onClick={onSignOut} className="btn btn-secondary w-full">
                            Sign Out
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <p className="text-xs text-secondary">
                            Free mode works without login (up to 500 bookmarks). Log in to save and restore backups.
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
