import React from 'react';
import { ProgressBar } from '../components/ProgressBar';
import { PopOutButton } from '../components/PopOutButton';

interface WeavingScreenProps {
    progress: number;
    statusMessage?: string;
    onCancel: () => void;
}

export const WeavingScreen: React.FC<WeavingScreenProps> = ({ progress, statusMessage = "Analyzing bookmark graph and building clusters.", onCancel }) => {
    return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center relative">
            <div className="absolute top-4 right-4 flex items-center gap-2">
                <span className="text-secondary text-xs">v 0.1</span>
                <PopOutButton />
            </div>

            <div className="flex items-center justify-center gap-3 mb-2">
                <img src="/icons/icon-48.png" alt="Logo" className="w-10 h-10" />
                <h1 className="text-3xl font-bold">Link Loom</h1>
            </div>
            <p className="mb-12 text-lg text-secondary">
                Organize your bookmarks<br />with AI clustering.
            </p>

            <div className="w-full mb-8 text-left">
                <p className="mb-3 text-base font-medium text-white">{statusMessage}</p>
                <ProgressBar progress={progress} />
            </div>

            <p className="text-sm text-secondary opacity-80 max-w-[280px] mb-6">
                Processing runs in the background. You can minimize or close this popup and reopen it to check progress.
            </p>
            
            <button 
                onClick={onCancel}
                className="text-sm text-red-400 hover:text-red-300 transition-colors font-medium border border-red-900/30 bg-red-900/10 px-4 py-2 rounded-md"
            >
                Cancel Processing
            </button>
        </div>
    );
};
