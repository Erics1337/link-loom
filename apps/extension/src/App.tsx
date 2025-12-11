import { useState } from 'react';
import { StartScreen } from './screens/StartScreen';
import { WeavingScreen } from './screens/WeavingScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Layout } from './components/Layout';
import { useBookmarkWeaver } from './hooks/useBookmarkWeaver';
import { useTheme } from './hooks/useTheme';
import './styles/global.css';

const App = () => {
    const { status, progress, clusters, stats, startWeaving, cancelWeaving, applyChanges, setStatus } = useBookmarkWeaver();
    const [view, setView] = useState<'main' | 'settings'>('main');
    useTheme(); // Initialize theme

    const renderContent = () => {
        if (view === 'settings') {
            return <SettingsScreen onBack={() => setView('main')} />;
        }

        switch (status) {
            case 'idle':
                return <StartScreen onStart={startWeaving} />;
            case 'weaving':
                // Logic: 
                // - If pending > 0, we are "Processing" (Ingesting/Embedding).
                // - If pending is low (<= 5), we are "Clustering" using the 'assigned' count.
                
                let progressPercent = 5;
                let statusMessage = "Analyzing bookmark graph...";

                if (progress.total > 0) {
                    const pendingPercent = ((progress.total - progress.pending) / progress.total) * 100;
                    
                    // If we are basically done with pending items but not "done"
                    if (progress.pending <= 5 && !status.includes('ready')) {
                        // Clustering Phase: Progress based on assigned bookmarks
                        const assignedPercent = (progress.assigned / progress.total) * 100;
                        progressPercent = Math.max(90, Math.min(assignedPercent, 99)); // Keep it at least 90% as we are done with ingest
                        
                        statusMessage = `Structuring ${progress.assigned} of ${progress.total} bookmarks...`;
                    } else {
                        // Processing Phase
                        progressPercent = Math.min(pendingPercent, 90); // Cap at 90% until clustering starts
                        statusMessage = `Processing ${progress.total - progress.pending} of ${progress.total} bookmarks...`;
                    }
                }

                return <WeavingScreen progress={progressPercent} statusMessage={statusMessage} onCancel={cancelWeaving} />;
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

    return (
        <Layout>
            {renderContent()}
        </Layout>
    );
};

export default App;
