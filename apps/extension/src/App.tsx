import { useState } from 'react';
import { StartScreen } from './screens/StartScreen';
import { WeavingScreen } from './screens/WeavingScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { LoginScreen, SignUpPlan } from './screens/LoginScreen';
import { BackupsScreen } from './screens/BackupsScreen';
import { ImportStructureScreen } from './screens/ImportStructureScreen';
import { Layout } from './components/Layout';
import { BookmarkBackupSnapshot, useBookmarkWeaver } from './hooks/useBookmarkWeaver';
import { useDeviceAuth } from './hooks/useDeviceAuth';
import { useClusteringSettings } from './hooks/useClusteringSettings';
import { useExtensionAuth } from './hooks/useExtensionAuth';
import { useTheme } from './hooks/useTheme';
import { BookmarkNode } from './components/BookmarkTree';
import {
    ApplyParsedBookmarkExportOptions,
    BookmarkImportSummary,
    ParsedBookmarkExport,
    applyParsedBookmarkExport,
    getBookmarkRootAvailability,
    parseBookmarkExportFile,
    parsedBookmarkExportToPreviewNodes,
    summarizeBookmarkExport,
} from './lib/bookmarkImport';
import './styles/global.css';

const WEB_APP_URL = (import.meta.env.VITE_WEB_APP_URL as string | undefined) || 'https://linkloom.org';
const App = () => {
    const {
        user: authUser,
        accessToken,
        refreshToken,
        errorMessage: authErrorMessage,
        ensureAnonymousSession,
        signIn,
        signUp,
        signOut
    } = useExtensionAuth();
    const isPermanentUser = Boolean(authUser && !authUser.isAnonymous);
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
    } = useBookmarkWeaver(
        authUser?.id,
        clusteringSettings,
        accessToken,
        ensureAnonymousSession,
        isPermanentUser
    );
    const [view, setView] = useState<'main' | 'settings' | 'login' | 'backups' | 'import-preview'>('main');
    const [backups, setBackups] = useState<BookmarkBackupSnapshot[]>([]);
    const [isImportingStructure, setIsImportingStructure] = useState(false);
    const [isApplyingImportedStructure, setIsApplyingImportedStructure] = useState(false);
    const [importStructureMessage, setImportStructureMessage] = useState<{
        kind: 'success' | 'error';
        text: string;
    } | null>(null);
    const [importPreviewMessage, setImportPreviewMessage] = useState<{
        kind: 'success' | 'error';
        text: string;
    } | null>(null);
    const [importPreview, setImportPreview] = useState<{
        fileName: string;
        parsedExport: ParsedBookmarkExport;
        summary: BookmarkImportSummary;
        nodes: BookmarkNode[];
    } | null>(null);
    useTheme();

    const { authStatus, errorMsg } = useDeviceAuth(isPermanentUser ? authUser?.id || '' : '', accessToken);

    const handleOpenBackups = async () => {
        if (!authUser) {
            setView('login');
            return;
        }

        const list = await loadBookmarkBackups();
        setBackups(list);
        setView('backups');
    };

    const startPaidCheckout = async (
        userIdForCheckout: string,
        email?: string | null,
        accessToken?: string
    ) => {
        if (!accessToken) {
            throw new Error('Sign in again before starting Pro checkout.');
        }

        const response = await fetch(`${WEB_APP_URL}/api/create-checkout-session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                userId: userIdForCheckout,
                email: email || undefined
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
            if (result.requiresEmailConfirmation) {
                throw new Error('Confirm your email first, then sign in and start Pro checkout.');
            }
            if (!result.authenticated || !result.userId) {
                throw new Error('Confirm your email first, then sign in and start Pro checkout.');
            }
            await startPaidCheckout(result.userId, result.email || email, result.accessToken);
        }

        if (result.authenticated && !result.requiresEmailConfirmation) {
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

    const handleImportStructure = async (file: File) => {
        setIsImportingStructure(true);
        setImportStructureMessage(null);
        try {
            const parsedExport = await parseBookmarkExportFile(file);
            const summary = summarizeBookmarkExport(parsedExport);
            setImportPreview({
                fileName: file.name,
                parsedExport,
                summary,
                nodes: parsedBookmarkExportToPreviewNodes(parsedExport) as BookmarkNode[],
            });
            setImportPreviewMessage(null);
            setView('import-preview');
        } catch (error) {
            setImportStructureMessage({
                kind: 'error',
                text: error instanceof Error ? error.message : 'Failed to load bookmark export.',
            });
        } finally {
            setIsImportingStructure(false);
        }
    };

    const handleApplyImportedStructure = async () => {
        if (!importPreview) return;

        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
            setImportPreviewMessage({
                kind: 'error',
                text: 'Chrome bookmark APIs are not available in this environment.',
            });
            return;
        }

        setIsApplyingImportedStructure(true);
        setImportPreviewMessage(null);

        try {
            const applyOptions: ApplyParsedBookmarkExportOptions = {
                mobileRootStrategy: 'require_mobile_root',
            };

            if (importPreview.summary.importedRoots.includes('Mobile Bookmarks')) {
                const rootAvailability = await getBookmarkRootAvailability();
                if (!rootAvailability['Mobile Bookmarks']) {
                    const useOtherBookmarksFallback = window.confirm(
                        'This Chrome profile does not currently expose the Mobile Bookmarks top-level folder. Press OK to place the imported Mobile Bookmarks folder inside Other Bookmarks, or Cancel to sign into Chrome first and try again.'
                    );

                    if (!useOtherBookmarksFallback) {
                        setImportPreviewMessage({
                            kind: 'error',
                            text: 'Sign into Chrome first if you want Mobile Bookmarks restored to its own top-level folder.',
                        });
                        return;
                    }

                    applyOptions.mobileRootStrategy = 'fallback_to_other_bookmarks';
                }
            }

            const rootLabel = importPreview.summary.importedRoots.join(', ');
            const confirmed = window.confirm(
                `Apply "${importPreview.fileName}" to ${rootLabel}? This will replace the current contents inside those Chrome bookmark roots.`
            );

            if (!confirmed) {
                return;
            }

            const appliedSummary = await applyParsedBookmarkExport(importPreview.parsedExport, applyOptions);
            setImportPreview(null);
            setView('main');
            setImportStructureMessage({
                kind: 'success',
                text:
                    applyOptions.mobileRootStrategy === 'fallback_to_other_bookmarks'
                        ? `Applied ${importPreview.fileName}. Mobile Bookmarks was placed inside Other Bookmarks because this Chrome profile does not currently expose the Mobile Bookmarks top-level folder.`
                        : `Applied ${importPreview.fileName} to ${appliedSummary.importedRoots.join(', ')}. Restored ${appliedSummary.bookmarkCount} bookmarks across ${appliedSummary.folderCount} folders.`,
            });
        } catch (error) {
            setImportPreviewMessage({
                kind: 'error',
                text: error instanceof Error ? error.message : 'Failed to apply imported structure.',
            });
        } finally {
            setIsApplyingImportedStructure(false);
        }
    };

    const renderContent = () => {
        // 1. Check Device Limit (Blocking)
        if (authStatus === 'limit_reached') {
            return (
                 <div className="app-shell">
                    <div className="panel">
                        <p className="eyebrow">Account limit</p>
                        <h1 className="screen-title mt-2">Device Limit Reached</h1>
                        <p className="screen-copy mt-3">{errorMsg || 'You have exceeded the maximum number of devices.'}</p>
                    </div>
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

        if (view === 'import-preview' && importPreview) {
            return (
                <ImportStructureScreen
                    fileName={importPreview.fileName}
                    nodes={importPreview.nodes}
                    bookmarkCount={importPreview.summary.bookmarkCount}
                    folderCount={importPreview.summary.folderCount}
                    onApply={handleApplyImportedStructure}
                    onBack={() => {
                        setImportPreview(null);
                        setImportPreviewMessage(null);
                        setView('main');
                    }}
                    isApplying={isApplyingImportedStructure}
                    message={importPreviewMessage}
                />
            );
        }

        // 3. Main App Flow
        switch (status) {
            case 'idle':
                return (
                    <StartScreen
                        onStart={handleStartOrganizing}
                        onImportStructure={handleImportStructure}
                        onOpenSettings={() => setView('settings')}
                        onOpenLogin={() => setView('login')}
                        onOpenBackups={handleOpenBackups}
                        onSignOut={signOut}
                        isLoggedIn={isPermanentUser}
                        isPremium={Boolean(isPermanentUser && isPremium)}
                        accountEmail={authUser?.email}
                        hasCachedResults={hasCachedResults}
                        isImportingStructure={isImportingStructure}
                        importStructureMessage={importStructureMessage}
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
                return (
                    <ResultsScreen
                        clusters={clusters}
                        stats={stats}
                        isPremium={Boolean(authUser && isPremium)}
                        onUpgrade={() => {
                            let url = `${WEB_APP_URL}/dashboard/billing`;
                            if (accessToken && refreshToken) {
                                url += `?access_token=${accessToken}&refresh_token=${refreshToken}`;
                            }
                            window.open(url, '_blank', 'noopener,noreferrer');
                        }}
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
                    <div className="app-shell">
                        <div className="panel">
                            <p className="eyebrow">Complete</p>
                            <h1 className="screen-title mt-2">All Done</h1>
                            <p className="screen-copy mt-3">Your bookmarks have been organized.</p>
                        </div>
                        <button onClick={() => setStatus('idle')} className="btn btn-primary">
                            Back to Home
                        </button>
                    </div>
                );
            case 'error': {
                const isLimitError = (errorMessage || '').toLowerCase().includes('free tier');
                return (
                    <div className="app-shell">
                        <div className="panel">
                            <p className="eyebrow">Error</p>
                            <h1 className="screen-title mt-2">Something stopped</h1>
                            <p className="screen-copy mt-3">{errorMessage || 'Something went wrong.'}</p>
                        </div>
                        {isLimitError && (
                            <a
                                href={accessToken && refreshToken ? `${WEB_APP_URL}/dashboard/billing?access_token=${accessToken}&refresh_token=${refreshToken}` : `${WEB_APP_URL}/dashboard/billing`}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-primary"
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
                    <div className="app-shell">
                        <div className="panel">
                            <p className="eyebrow">Choose your run</p>
                            <h1 className="screen-title mt-2">You have {total.toLocaleString()} bookmarks</h1>
                            <p className="screen-copy mt-3">
                                Free preview organizes {limit.toLocaleString()} bookmarks now. The remaining {extra.toLocaleString()} stay exactly where they are.
                            </p>
                        </div>
                        <div className="card space-y-3">
                            <div className="stat-row">
                                <span className="text-secondary text-sm">Included now</span>
                                <span className="badge-count">{limit.toLocaleString()}</span>
                            </div>
                            <div className="stat-row">
                                <span className="text-secondary text-sm">Left untouched</span>
                                <span className="badge-count">{extra.toLocaleString()}</span>
                            </div>
                        </div>
                        <button
                            onClick={continueWithLimitedBookmarks}
                            className="btn btn-primary w-full"
                        >
                            Preview first {limit.toLocaleString()} bookmarks
                        </button>
                        <a
                            href={accessToken && refreshToken ? `${WEB_APP_URL}/dashboard/billing?access_token=${accessToken}&refresh_token=${refreshToken}` : `${WEB_APP_URL}/dashboard/billing`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn w-full"
                        >
                            Upgrade to organize all {total.toLocaleString()}
                        </a>
                        <button onClick={() => setStatus('idle')} className="btn btn-ghost">
                            Back
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
