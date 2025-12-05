import React from 'react';
import { useTheme } from '../hooks/useTheme';

interface SettingsScreenProps {
    onBack: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onBack }) => {
    const { theme, toggleTheme } = useTheme();

    return (
        <div className="flex flex-col h-full p-4">
            <div className="flex items-center mb-6">
                <button onClick={onBack} className="mr-4 text-secondary hover:text-primary">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </button>
                <h1 className="text-xl font-bold">Settings</h1>
            </div>

            <div className="space-y-4">
                <div className="card">
                    <h2 className="mb-2 text-sm font-medium text-secondary">Account</h2>
                    <div className="flex items-center justify-between py-2">
                        <span>User ID</span>
                        <span className="text-xs text-secondary font-mono bg-white/5 px-2 py-1 rounded">
                            {/* User ID would go here */}
                            ********
                        </span>
                    </div>
                </div>

                <div className="card">
                    <h2 className="mb-2 text-sm font-medium text-secondary">Preferences</h2>
                    <label className="flex items-center justify-between py-2 cursor-pointer">
                        <span>Dark Mode</span>
                        <div className="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                            <input
                                type="checkbox"
                                name="toggle"
                                id="toggle"
                                checked={theme === 'dark'}
                                onChange={toggleTheme}
                                className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer transition-transform duration-200 ease-in-out"
                                style={{
                                    right: theme === 'dark' ? '0' : 'auto',
                                    left: theme === 'dark' ? 'auto' : '0',
                                    borderColor: theme === 'dark' ? '#3B82F6' : '#ccc'
                                }}
                            />
                            <label
                                htmlFor="toggle"
                                className={`toggle-label block overflow-hidden h-5 rounded-full cursor-pointer ${theme === 'dark' ? 'bg-blue-500' : 'bg-gray-300'}`}
                            ></label>
                        </div>
                    </label>
                </div>

                <button className="btn w-full bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20">
                    Reset Extension
                </button>
            </div>
        </div>
    );
};
