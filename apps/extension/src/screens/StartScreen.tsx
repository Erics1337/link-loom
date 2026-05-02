import React from 'react';
import { Archive, ArrowRight, LogOut, Settings, Sparkles } from 'lucide-react';
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
        <div className="app-shell">
            <div className="app-header">
                <span className="badge">v {version}</span>
                <div className="flex items-center gap-2">
                    <button onClick={onOpenSettings} className="btn-icon" title="Clustering Settings">
                        <Settings size={18} />
                    </button>
                    <PopOutButton />
                </div>
            </div>

            <section className="panel">
                <div className="brand-lockup">
                    <img src="/icons/icon-48.png" alt="Link Loom" className="brand-icon" />
                    <div>
                        <p className="eyebrow">Bookmark workspace</p>
                        <h1 className="screen-title">Link Loom</h1>
                    </div>
                </div>
                <p className="screen-copy mt-3">
                    Turn saved links into a searchable folder map before bookmark clutter takes over.
                </p>
            </section>

            <section className="card space-y-3">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".html,text/html"
                    style={{ display: 'none' }}
                    onChange={(event) => void handleImportChange(event)}
                />
                <button onClick={onStart} className="btn btn-primary w-full">
                    Organize Bookmarks <ArrowRight size={16} />
                </button>
                <div className="grid" style={{ gridTemplateColumns: hasCachedResults ? '1fr 1fr' : '1fr' }}>
                    {hasCachedResults && (
                        <button onClick={onResume} className="btn btn-secondary">
                            Resume
                        </button>
                    )}
                    <button onClick={handleImportClick} className="btn btn-secondary" disabled={isImportingStructure}>
                        {isImportingStructure ? 'Loading...' : 'Import Structure'}
                    </button>
                </div>
                {importStructureMessage && (
                    <div className={`message ${importStructureMessage.kind === 'error' ? 'message-error' : 'message-success'}`}>
                        {importStructureMessage.text}
                    </div>
                )}
            </section>

            <section className="card mt-auto">
                {isLoggedIn ? (
                    <div className="space-y-3">
                        <div className="stat-row">
                            <div className="truncate">
                                <p className="eyebrow">{isPremium ? 'Pro account' : 'Free account'}</p>
                                <p className="text-sm text-primary truncate">{accountEmail || 'Logged in'}</p>
                            </div>
                            <span className="badge">{isPremium ? 'PRO' : 'FREE'}</span>
                        </div>

                        {!isPremium && (
                            <button onClick={onUpgrade} className="btn btn-primary w-full">
                                <Sparkles size={15} /> Upgrade to Pro
                            </button>
                        )}

                        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <button onClick={onOpenBackups} className="btn btn-secondary">
                                <Archive size={15} /> Backups
                            </button>
                            <button onClick={onSignOut} className="btn btn-secondary">
                                <LogOut size={15} /> Sign out
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div>
                            <p className="eyebrow">Free tier</p>
                            <p className="screen-copy">Organize up to 500 bookmarks. Sign in for backups and plan sync.</p>
                        </div>
                        <button onClick={onOpenLogin} className="btn btn-primary w-full">
                            Log In / Sign Up
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
};
