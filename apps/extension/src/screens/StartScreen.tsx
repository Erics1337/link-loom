import React from 'react';

interface StartScreenProps {
    onStart: () => void;
}

export const StartScreen: React.FC<StartScreenProps> = ({ onStart }) => {
    return (
        <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            <h1 className="mb-2 text-3xl font-bold">Link Loom</h1>
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
