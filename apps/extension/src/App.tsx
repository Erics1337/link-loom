import { useState, useEffect } from 'react';
import { StartScreen } from './screens/StartScreen';
import { WeavingScreen } from './screens/WeavingScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Layout } from './components/Layout';
import { useBookmarkWeaver } from './hooks/useBookmarkWeaver';
import { useDeviceAuth } from './hooks/useDeviceAuth';
import { useTheme } from './hooks/useTheme';
import './styles/global.css';

const App = () => {
    // We get isPremium from the hook now
    const { status, progress, clusters, stats, startWeaving, cancelWeaving, applyChanges, setStatus } = useBookmarkWeaver();
    const [view, setView] = useState<'main' | 'settings'>('main');
    useTheme();

    // Device Auth Logic
    const [userId, setUserId] = useState<string>('');
    
    useEffect(() => {
        chrome.storage.local.get(['userId'], (res: { userId?: string }) => {
             if (res.userId) setUserId(res.userId);
        });
    }, []);

    const { authStatus, errorMsg } = useDeviceAuth(userId);

    const renderContent = () => {
        // 1. Check Device Limit (Blocking)
        if (authStatus === 'limit_reached') {
            return (
                 <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                    <h1 className="text-2xl font-bold mb-4 text-red-500">Device Limit Reached</h1>
                    <p className="text-secondary mb-8">{errorMsg || 'You have exceeded the maximum number of devices.'}</p>
                    <a href="http://localhost:3000/dashboard/devices" target="_blank" rel="noreferrer" className="btn btn-primary">
                        Manage Devices
                    </a>
                </div>
            );
        }

        // 2. Settings View
        if (view === 'settings') {
            return <SettingsScreen onBack={() => setView('main')} />;
        }

        // 3. Main App Flow
        switch (status) {
            case 'idle':
                return <StartScreen onStart={startWeaving} />;
            case 'weaving':
                let progressPercent = 5;
                let statusMessage = "Analyzing bookmark graph...";

                if (progress.total > 0) {
                    const pendingPercent = ((progress.total - progress.pending) / progress.total) * 100;
                    if (progress.pending <= 5 && !status.includes('ready')) {
                        const assignedPercent = (progress.assigned / progress.total) * 100;
                        progressPercent = Math.max(90, Math.min(assignedPercent, 99)); 
                        statusMessage = `Structuring ${progress.assigned} of ${progress.total} bookmarks...`;
                    } else {
                        progressPercent = Math.min(pendingPercent, 90);
                        statusMessage = `Processing ${progress.total - progress.pending} of ${progress.total} bookmarks...`;
                    }
                }
                return <WeavingScreen progress={progressPercent} statusMessage={statusMessage} onCancel={cancelWeaving} />;
            case 'ready':
                // Here we can show a "Premium Only" banner if they used a premium feature, 
                // but for now we just show the results.
                return (
                    <ResultsScreen
                        clusters={clusters}
                        stats={stats}
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
            case 'error':
                 return (
                    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                        <h1 className="text-2xl font-bold mb-4 text-red-500">Error</h1>
                        <p className="text-secondary mb-8">Something went wrong.</p>
                        <button onClick={() => setStatus('idle')} className="btn">
                            Try Again
                        </button>
                    </div>
                );
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
