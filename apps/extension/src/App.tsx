import { useState } from 'react';
import { StartScreen } from './screens/StartScreen';
import { WeavingScreen } from './screens/WeavingScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useBookmarkWeaver } from './hooks/useBookmarkWeaver';
import { useTheme } from './hooks/useTheme';
import './styles/global.css';

const App = () => {
    const { status, progress, clusters, stats, startWeaving, applyChanges, setStatus } = useBookmarkWeaver();
    const [view, setView] = useState<'main' | 'settings'>('main');
    useTheme(); // Initialize theme

    if (view === 'settings') {
        return <SettingsScreen onBack={() => setView('main')} />;
    }

    switch (status) {
        case 'idle':
            return <StartScreen onStart={startWeaving} />;
        case 'weaving':
            const progressPercent = progress.total > 0
                ? ((progress.total - progress.pending) / progress.total) * 100
                : 5;
            return <WeavingScreen progress={progressPercent} />;
        case 'ready':
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
                    <p className="text-secondary mb-8">Something went wrong. Please try again.</p>
                    <button onClick={() => setStatus('idle')} className="btn">
                        Try Again
                    </button>
                </div>
            );
        default:
            return null;
    }
};

export default App;
