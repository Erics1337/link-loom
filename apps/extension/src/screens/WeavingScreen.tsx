import React from 'react';
import { ProgressBar } from '../components/ProgressBar';

interface WeavingScreenProps {
    progress: number;
    statusMessage?: string;
    onCancel: () => void;
}

export const WeavingScreen: React.FC<WeavingScreenProps> = ({ progress, statusMessage = "Analyzing bookmark graph and building clusters.", onCancel }) => {
    return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <h1 className="mb-2 text-3xl font-bold">Link Loom</h1>
            <p className="mb-12 text-lg text-secondary">
                Organize your bookmarks<br />with AI clustering.
            </p>

            <div className="w-full mb-8 text-left">
                <p className="mb-3 text-base font-medium text-white">{statusMessage}</p>
                <ProgressBar progress={progress} />
            </div>

            <p className="text-sm text-secondary opacity-80 max-w-[280px] mb-6">
                You can keep this window open while Link Loom groups similar links together.
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
