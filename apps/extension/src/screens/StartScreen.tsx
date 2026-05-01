import React from 'react';
import { Settings } from 'lucide-react';
import { PopOutButton } from '../components/PopOutButton';
import { useVersion } from '../hooks/useVersion';

const WEB_APP_URL = (import.meta.env.VITE_WEB_APP_URL as string | undefined) || 'https://linkloom.org';

interface StartScreenProps {
    onStart: () => void;
    onImportStructure: (file: File) => Promise<void>;
    onOpenSettings: () => void;
    onOpenLogin: () => void;
    onOpenBackups: () => void;
    onSignOut: () => void;
    isLoggedIn: boolean;
    isPremium: boolean;
    accountEmail?: string | null;
    hasCachedResults: boolean;
    isImportingStructure: boolean;
    importStructureMessage?: {
        kind: 'success' | 'error';
        text: string;
    } | null;
    onResume: () => void;
}

export const StartScreen: React.FC<StartScreenProps> = ({
    onStart,
    onImportStructure,
    onOpenSettings,
    onOpenLogin,
    onOpenBackups,
    onSignOut,
    isLoggedIn,
    isPremium,
    accountEmail,
    hasCachedResults,
    isImportingStructure,
    importStructureMessage,
    onResume
}) => {
    const version = useVersion();
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);

    const onUpgrade = () => {
        window.open(`${WEB_APP_URL}/dashboard/billing`, '_blank', 'noopener,noreferrer');
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        await onImportStructure(file);
    };

    return (
        <div className="flex flex-col h-full p-4 relative">
            <div className="absolute top-4 right-4 flex items-center gap-2">
                <span className="text-secondary text-xs mr-1">v {version}</span>
                <PopOutButton />
            </div>

            <div className="flex-1 flex flex-col items-center pt-[15vh] text-center">
                <div className="flex items-center justify-center gap-4 mb-4">
                    <img src="/icons/icon-48.png" alt="Logo" className="w-12 h-12 shadow-sm" />
                    <h1 className="text-4xl font-bold tracking-tight">Link Loom</h1>
                </div>
                <p className="mb-10 text-[15px] leading-relaxed text-secondary px-4">
                    Organize your bookmarks<br />with AI clustering.
                </p>

                <div className="flex flex-col items-center gap-2 w-full justify-center" style={{ maxWidth: '280px' }}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".html,text/html"
                        style={{ display: 'none' }}
                        onChange={(event) => void handleImportChange(event)}
                    />
                    <div className="flex items-center gap-2 w-full">
                        <button
                            onClick={onStart}
                            className="btn btn-primary flex-1 py-3 text-[15px] font-medium transition-transform active:scale-95 shadow-lg"
                        >
                            Organize Bookmarks
                        </button>
                        
                        <button
                            onClick={onOpenSettings}
                            className="btn-icon h-[46px] w-[46px] flex items-center justify-center flex-shrink-0"
                            title="Clustering Settings"
                        >
                            <Settings size={20} />
                        </button>
                    </div>
                    {hasCachedResults && (
                        <button
                            onClick={onResume}
                            className="btn btn-secondary w-full py-2.5 text-[15px] font-medium transition-transform active:scale-95 shadow-sm mt-1"
                        >
                            Resume Recent Analysis
                        </button>
                    )}
                    <button
                        onClick={handleImportClick}
                        className="btn btn-secondary w-full py-2.5 text-[15px] font-medium transition-transform active:scale-95 shadow-sm mt-1"
                        disabled={isImportingStructure}
                    >
                        {isImportingStructure ? 'Loading Structure...' : 'Import Structure'}
                    </button>
                    {importStructureMessage && (
                        <div
                            className="card w-full text-left mt-1"
                            style={{
                                borderColor:
                                    importStructureMessage.kind === 'error'
                                        ? 'rgba(239, 68, 68, 0.3)'
                                        : 'rgba(34, 197, 94, 0.3)',
                            }}
                        >
                            <p
                                className="text-xs"
                                style={{
                                    color:
                                        importStructureMessage.kind === 'error'
                                            ? '#fca5a5'
                                            : '#86efac',
                                }}
                            >
                                {importStructureMessage.text}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex justify-center w-full mt-auto mb-2">
                <div className="card w-full bg-[#1e293b]/80 border border-white/10 backdrop-blur-md rounded-xl p-5 shadow-lg transition-all" style={{ maxWidth: '300px' }}>
                    {isLoggedIn ? (
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between bg-black/20 rounded-lg p-2.5 border border-white/5 shadow-inner">
                                <p className="text-sm font-medium text-white/90 truncate mr-2 ml-1">
                                    {accountEmail || 'Logged in'}
                                </p>
                                <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-md tracking-wider flex-shrink-0 ${isPremium ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                    {isPremium ? 'PRO TIER' : 'FREE'}
                                </span>
                            </div>
                            
                            {!isPremium && (
                                <button onClick={onUpgrade} className="btn w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-medium text-sm border-0 shadow-sm transition-all mb-1">
                                    Upgrade to Pro
                                </button>
                            )}

                            <div className="grid grid-cols-2 gap-2 mt-1">
                                <button onClick={onOpenBackups} className="btn btn-secondary text-xs py-2 shadow-sm">
                                    Backups
                                </button>
                                <button onClick={onSignOut} className="btn btn-secondary text-xs py-2 text-gray-400 hover:text-white shadow-sm">
                                    Sign Out
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4 text-center">
                            <div className="space-y-1">
                                <h3 className="text-sm font-medium text-white/90 tracking-wide">Free Tier Limits</h3>
                                <p className="text-[13px] leading-relaxed text-secondary/90">
                                    Free mode allows up to 500 bookmarks.
                                </p>
                            </div>
                            <button 
                                onClick={onOpenLogin} 
                                className="bg-white/10 hover:bg-white/20 text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-colors border border-white/5 w-full shadow-sm"
                            >
                                Log In / Sign Up
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
