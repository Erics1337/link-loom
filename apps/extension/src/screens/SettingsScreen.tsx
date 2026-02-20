import React from 'react';
import { useTheme } from '../hooks/useTheme';
import { ClusteringSettings, FolderDensity, NamingTone, OrganizationMode } from '../lib/clusteringSettings';

interface SettingsScreenProps {
    onBack: () => void;
    settings: ClusteringSettings;
    onSettingsChange: (next: Partial<ClusteringSettings>) => void;
}

const densityOptions: Array<{ value: FolderDensity; label: string; hint: string }> = [
    { value: 'less', label: 'Less folders', hint: 'Bigger groups with broader categories.' },
    { value: 'medium', label: 'Medium', hint: 'Balanced depth and findability.' },
    { value: 'more', label: 'More folders', hint: 'Smaller groups with finer topic splits.' },
];

const toneOptions: Array<{ value: NamingTone; label: string; hint: string }> = [
    { value: 'clear', label: 'Clear', hint: 'Literal and straightforward names.' },
    { value: 'balanced', label: 'Balanced', hint: 'Mostly direct with slight personality.' },
    { value: 'playful', label: 'Playful', hint: 'Creative names with topical anchors.' },
];

const organizationOptions: Array<{ value: OrganizationMode; label: string; hint: string }> = [
    { value: 'topic', label: 'Topic-first', hint: 'Prefer specific topics.' },
    { value: 'category', label: 'Category-first', hint: 'Prefer broader categories.' },
];

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onBack, settings, onSettingsChange }) => {
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

            <div className="space-y-4 overflow-y-auto pr-1">
                <div className="card">
                    <h2 className="mb-2 text-sm font-medium text-secondary">Clustering</h2>
                    <label className="text-xs text-secondary block mb-2">Folder density</label>
                    <select
                        className="w-full btn btn-secondary text-left"
                        value={settings.folderDensity}
                        onChange={(event) => onSettingsChange({ folderDensity: event.target.value as FolderDensity })}
                    >
                        {densityOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-secondary mt-2">
                        {densityOptions.find(option => option.value === settings.folderDensity)?.hint}
                    </p>

                    <label className="text-xs text-secondary block mb-2 mt-4">Organization mode</label>
                    <select
                        className="w-full btn btn-secondary text-left"
                        value={settings.organizationMode}
                        onChange={(event) => onSettingsChange({ organizationMode: event.target.value as OrganizationMode })}
                    >
                        {organizationOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-secondary mt-2">
                        {organizationOptions.find(option => option.value === settings.organizationMode)?.hint}
                    </p>
                </div>

                <div className="card">
                    <h2 className="mb-2 text-sm font-medium text-secondary">Folder Naming</h2>
                    <label className="text-xs text-secondary block mb-2">Naming tone</label>
                    <select
                        className="w-full btn btn-secondary text-left"
                        value={settings.namingTone}
                        onChange={(event) => onSettingsChange({ namingTone: event.target.value as NamingTone })}
                    >
                        {toneOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-secondary mt-2">
                        {toneOptions.find(option => option.value === settings.namingTone)?.hint}
                    </p>

                    <label className="flex items-center justify-between py-3 mt-2 cursor-pointer border-t border-white-10">
                        <div className="text-left">
                            <span className="block">Use Emojis In Names</span>
                            <span className="text-xs text-secondary">Adds emoji prefixes to folder names and auto-renamed bookmarks.</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={settings.useEmojiNames}
                            onChange={(event) => onSettingsChange({ useEmojiNames: event.target.checked })}
                        />
                    </label>
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
            </div>
        </div>
    );
};
