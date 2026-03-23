import { useState } from 'react';
import { StartScreen } from './screens/StartScreen';
import { WeavingScreen } from './screens/WeavingScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { LoginScreen, SignUpPlan } from './screens/LoginScreen';
import { BackupsScreen } from './screens/BackupsScreen';
import { Layout } from './components/Layout';
import { BookmarkBackupSnapshot, useBookmarkWeaver } from './hooks/useBookmarkWeaver';
import { useDeviceAuth } from './hooks/useDeviceAuth';
import { useClusteringSettings } from './hooks/useClusteringSettings';
import { useExtensionAuth } from './hooks/useExtensionAuth';
import { useTheme } from './hooks/useTheme';
import './styles/global.css';

const WEB_APP_URL = (import.meta.env.VITE_WEB_APP_URL as string | undefined) || 'https://linkloom.org';
const STRIPE_PRO_PRICE_ID = import.meta.env.VITE_STRIPE_PRICE_ID_PRO as string | undefined;

const App = () => {
    const { user: authUser, errorMessage: authErrorMessage, signIn, signUp, signOut } = useExtensionAuth();
    const { settings: clusteringSettings, updateSettings: updateClusteringSettings } = useClusteringSettings();
    const {
        status,
        weavingPhase,
        limitExceededInfo,
        hasCachedResults,
        resumeWeavingSession,
        continueWithLimitedBookmarks,
        progress,
        clusters,
        stats,
        isPremium,
        startWeaving,
        cancelWeaving,
        loadBookmarkBackups,
        saveCurrentBookmarkBackup,
        deleteBookmarkBackup,
        restoreBookmarkBackup,
        autoRenameBookmarks,
        isAutoRenaming,
        deleteAllDuplicates,
        deleteAllDeadLinks,
        scanDeadLinks,
        isDeletingDuplicates,
        isDeletingDeadLinks,
        isScanningDeadLinks,
        applyChanges,
        setStatus,
        errorMessage
    } = useBookmarkWeaver(authUser?.id, clusteringSettings);
    const [view, setView] = useState<'main' | 'settings' | 'login' | 'backups'>('main');
    const [backups, setBackups] = useState<BookmarkBackupSnapshot[]>([]);
    useTheme();

    const { authStatus, errorMsg } = useDeviceAuth(authUser?.id || '');

    const handleOpenBackups = async () => {
        if (!authUser) {
            setView('login');
            return;
        }

        const list = await loadBookmarkBackups();
        setBackups(list);
        setView('backups');
    };

    const startPaidCheckout = async (userIdForCheckout: string, email?: string | null) => {
        if (!STRIPE_PRO_PRICE_ID) {
            throw new Error('Pro checkout is not configured. Set VITE_STRIPE_PRICE_ID_PRO.');
        }

        const response = await fetch(`${WEB_APP_URL}/api/create-checkout-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userIdForCheckout,
                email: email || undefined,
                mode: 'subscription',
                priceId: STRIPE_PRO_PRICE_ID,
                successUrl: `${WEB_APP_URL}/dashboard/billing?success=true`,
                cancelUrl: `${WEB_APP_URL}/dashboard/billing?canceled=true`
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.url) {
            throw new Error(payload?.error || payload?.message || 'Failed to create checkout session.');
        }

        window.open(payload.url as string, '_blank', 'noopener,noreferrer');
    };

    const handleSignIn = async (email: string, password: string) => {
        await signIn(email, password);
        setView('main');
    };

    const handleSignUp = async (email: string, password: string, plan: SignUpPlan) => {
        const result = await signUp(email, password);
        if (plan === 'paid') {
            if (!result.authenticated || !result.userId) {
                throw new Error('Confirm your email first, then sign in and start Pro checkout.');
            }
            await startPaidCheckout(result.userId, result.email || email);
        }

        if (result.authenticated) {
            setView('main');
        }

        return result;
    };

    const handleStartOrganizing = async () => {
        await startWeaving();
    };

    const handleRestoreBackup = async (backupId: string) => {
        await restoreBookmarkBackup(backupId);
    };

    const handleDeleteBackup = async (backupId: string) => {
        await deleteBookmarkBackup(backupId);
        const list = await loadBookmarkBackups();
        setBackups(list);
    };

    const handleSaveCurrentBackup = async () => {
        await saveCurrentBookmarkBackup();
        const list = await loadBookmarkBackups();
        setBackups(list);
    };

    const renderContent = () => {
        // 1. Check Device Limit (Blocking)
        if (authStatus === 'limit_reached') {
            return (
                 <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                    <h1 className="text-2xl font-bold mb-4 text-red-500">Device Limit Reached</h1>
                    <p className="text-secondary mb-8">{errorMsg || 'You have exceeded the maximum number of devices.'}</p>
                    <a href={`${WEB_APP_URL}/dashboard/devices`} target="_blank" rel="noreferrer" className="btn btn-primary">
                        Manage Devices
                    </a>
                </div>
            );
        }

        // 2. Settings View
        if (view === 'settings') {
            return (
                <SettingsScreen
                    onBack={() => setView('main')}
                    settings={clusteringSettings}
                    onSettingsChange={updateClusteringSettings}
                />
            );
        }

        if (view === 'login') {
            return (
                <LoginScreen
                    onBack={() => setView('main')}
                    onSignIn={handleSignIn}
                    onSignUp={handleSignUp}
                    initialError={authErrorMessage}
                />
            );
        }

        if (view === 'backups') {
            return (
                <BackupsScreen
                    backups={backups}
                    onBack={() => setView('main')}
                    onSaveCurrent={handleSaveCurrentBackup}
                    onRestore={handleRestoreBackup}
                    onDelete={handleDeleteBackup}
                />
            );
        }

        // 3. Main App Flow
        switch (status) {
            case 'idle':
                return (
                    <StartScreen
                        onStart={handleStartOrganizing}
                        onOpenSettings={() => setView('settings')}
                        onOpenLogin={() => setView('login')}
                        onOpenBackups={handleOpenBackups}
                        onSignOut={signOut}
                        isLoggedIn={Boolean(authUser)}
                        isPremium={Boolean(authUser && isPremium)}
                        accountEmail={authUser?.email}
                        hasCachedResults={hasCachedResults}
                        onResume={resumeWeavingSession}
                    />
                );
            case 'weaving':
                let progressPercent = 5;
                let statusMessage = "Analyzing bookmark graph...";
                let statusDetail = "";
                const totalBookmarks = Math.max(progress.total || progress.ingestTotal || 0, 0);
                const safeTotal = Math.max(totalBookmarks, 1);
                const safeEmbedded = Math.min(progress.embedded || 0, totalBookmarks);
                const safeAssigned = Math.min(progress.assigned || 0, totalBookmarks);

                // Backup phase — show before any processing starts
                if (weavingPhase === 'backup') {
                    progressPercent = 3;
                    statusMessage = "Saving a backup of your bookmarks...";
                    statusDetail = "A local backup is being saved before organizing begins.";
                } else if (progress.isIngesting && progress.assigned === 0 && progress.clusters === 0) {
                    const ingestTotal = Math.max(progress.ingestTotal || progress.total || 0, 1);
                    const ingestProcessed = Math.min(progress.ingestProcessed || 0, ingestTotal);
                    progressPercent = Math.max(8, Math.min((ingestProcessed / ingestTotal) * 45, 45));
                    statusMessage = `Stage 1/3: Indexing ${ingestProcessed} of ${ingestTotal} bookmarks...`;
                    statusDetail = "Scanning links, checking cache hits, and queueing uncached pages.";
                } else if (totalBookmarks > 0 && progress.pending > 0) {
                    const embedPercent = Math.min((safeEmbedded / safeTotal) * 100, 100);
                    progressPercent = Math.max(45, Math.min(45 + (embedPercent * 0.45), 90));
                    statusMessage = "Stage 2/3: Enriching pages and generating embeddings...";

                    const detailParts = [
                        `Queued: ${progress.pendingRaw || 0}`,
                        `Enriched: ${progress.enriched || 0}`,
                        `Embedded: ${safeEmbedded}/${totalBookmarks}`
                    ];

                    if (progress.isClusteringActive || progress.clusters > 0) {
                        detailParts.push(`Folders: ${progress.clusters}`);
                    }

                    if (progress.errored > 0) {
                        detailParts.push(`Errors: ${progress.errored}`);
                    } else {
                        detailParts.push("Errors: 0");
                    }

                    statusDetail = detailParts.join(" • ");
                } else if (totalBookmarks > 0) {
                    if (safeAssigned > 0) {
                        const assignedPercent = (safeAssigned / safeTotal) * 100;
                        progressPercent = Math.max(90, Math.min(90 + (assignedPercent * 0.09), 99));
                        statusMessage = "Stage 3/3: Structuring bookmarks into folders...";
                        const remaining = Math.max(
                            progress.remainingToAssign || (totalBookmarks - safeAssigned - (progress.errored || 0)),
                            0
                        );
                        statusDetail = `Assigned: ${safeAssigned}/${totalBookmarks} • Folders: ${progress.clusters} • Remaining: ${remaining}`;
                    } else {
                        const clusterSignal = Math.log10((progress.clusters || 0) + 1);
                        const clusterDrivenPercent = 88 + Math.min(clusterSignal * 3.3, 10);
                        progressPercent = Math.max(88, Math.min(clusterDrivenPercent, 98));
                        statusMessage = "Stage 3/3: Preparing clustered structure...";
                        statusDetail = progress.clusters > 0
                            ? `Folders created: ${progress.clusters} • Waiting for first assignment batch`
                            : "Creating initial folder groups from embedded bookmarks.";
                    }
                }
                return (
                    <WeavingScreen
                        progress={progressPercent}
                        statusMessage={statusMessage}
                        statusDetail={statusDetail}
                        onCancel={cancelWeaving}
                    />
                );
            case 'ready':
                // Here we can show a "Premium Only" banner if they used a premium feature, 
                // but for now we just show the results.
                return (
                    <ResultsScreen
                        clusters={clusters}
                        stats={stats}
                        onAutoRename={autoRenameBookmarks}
                        isAutoRenaming={isAutoRenaming}
                        onOpenSettings={() => setView('settings')}
                        onDeleteDuplicates={deleteAllDuplicates}
                        onDeleteDeadLinks={deleteAllDeadLinks}
                        onScanDeadLinks={scanDeadLinks}
                        isDeletingDuplicates={isDeletingDuplicates}
                        isDeletingDeadLinks={isDeletingDeadLinks}
                        isScanningDeadLinks={isScanningDeadLinks}
                        onApply={applyChanges}
                        onBack={() => setStatus('idle')}
                    />
                );
            case 'done':
                return (
                    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                        <h1 className="text-2xl font-bold mb-4">All Done!</h1>
                        <p className="text-secondary mb-8">Your bookmarks have been organized.</p>
                        <button onClick={() => setStatus('idle')} className="btn btn-primary">
                            Back to Home
                        </button>
                    </div>
                );
            case 'error': {
                const isLimitError = (errorMessage || '').toLowerCase().includes('free tier');
                return (
                    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                        <h1 className="text-2xl font-bold mb-4 text-red-500">Error</h1>
                        <p className="text-secondary mb-8">
                            {errorMessage || 'Something went wrong.'}
                        </p>
                        {isLimitError && (
                            <a
                                href={`${WEB_APP_URL}/dashboard/billing`}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-primary mb-3"
                            >
                                Upgrade to Pro
                            </a>
                        )}
                        <button onClick={() => setStatus('idle')} className="btn">
                            Try Again
                        </button>
                    </div>
                );
            }
            case 'limit_exceeded': {
                const info = limitExceededInfo;
                const limit = info?.limit ?? 500;
                const total = info?.total ?? 0;
                const extra = total - limit;
                return (
                    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                        <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center mb-4">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                            </svg>
                        </div>
                        <h1 className="text-xl font-bold mb-2">Too many bookmarks</h1>
                        <p className="text-secondary text-sm mb-6 max-w-[280px]">
                            You have <strong className="text-white">{total.toLocaleString()}</strong> bookmarks, but the free tier supports up to <strong className="text-white">{limit.toLocaleString()}</strong>.
                            Only the first <strong className="text-white">{limit.toLocaleString()}</strong> bookmarks will be organized right now. The remaining <strong className="text-white">{extra.toLocaleString()}</strong> won&apos;t be touched.
                        </p>
                        <button
                            onClick={continueWithLimitedBookmarks}
                            className="btn btn-primary w-full mb-3"
                        >
                            Organize first {limit.toLocaleString()} bookmarks
                        </button>
                        <a
                            href={`${WEB_APP_URL}/dashboard/billing`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn w-full mb-3"
                        >
                            Upgrade to Pro — unlimited bookmarks
                        </a>
                        <button onClick={() => setStatus('idle')} className="text-sm text-secondary hover:text-white transition-colors">
                            Cancel
                        </button>
                    </div>
                );
            }
            default:
                return null;
        }
    };

    return (
        <Layout>
            {renderContent()}
        </Layout>
    );
};

export default App;
