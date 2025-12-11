import React from 'react';
import { PopOutButton } from '../components/PopOutButton';

interface StartScreenProps {
    onStart: () => void;
}

export const StartScreen: React.FC<StartScreenProps> = ({ onStart }) => {
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
        </div>
    );
};
