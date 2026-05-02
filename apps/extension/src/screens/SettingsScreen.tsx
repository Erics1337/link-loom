import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '../hooks/useTheme';
import { ClusteringSettings, FolderDensity, NamingTone, OrganizationMode } from '../lib/clusteringSettings';
import { ArrowLeft, FolderTree, Type, Moon, ChevronDown } from 'lucide-react';

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

const CustomSelect = ({ value, onChange, options }: { value: string, onChange: (val: any) => void, options: any[] }) => {
    const [isOpen, setIsOpen] = useState(false);
    const selectRef = useRef<HTMLDivElement>(null);
    const selected = options.find(o => o.value === value) || options[0];

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={selectRef}>
            <button 
                type="button"
                className="select-trigger flex items-center justify-between"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span>{selected.label}</span>
                <ChevronDown size={14} className="text-secondary" />
            </button>
            
            {isOpen && (
                <div className="select-menu">
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            className={`select-option ${option.value === value ? 'select-option-active' : ''}`}
                            onClick={() => {
                                onChange(option.value);
                                setIsOpen(false);
                            }}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onBack, settings, onSettingsChange }) => {
    const { theme, toggleTheme } = useTheme();

    return (
        <div className="app-shell">
            <div className="app-header">
                <button onClick={onBack} className="btn-icon" title="Go Back">
                    <ArrowLeft size={18} />
                </button>
                <div className="flex-1">
                    <p className="eyebrow">Preferences</p>
                    <h1 className="screen-title">Settings</h1>
                </div>
            </div>

            <div className="app-scroll space-y-4">
                <section>
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <FolderTree size={16} className="text-accent" />
                        <h2 className="text-sm font-bold">Clustering Behavior</h2>
                    </div>
                    
                    <div className="card space-y-4">
                        <div>
                            <div className="text-sm font-bold mb-1">Folder Density</div>
                            <p className="text-xs text-secondary mb-3">
                                {densityOptions.find(option => option.value === settings.folderDensity)?.hint}
                            </p>
                            <CustomSelect 
                                value={settings.folderDensity} 
                                onChange={(val) => onSettingsChange({ folderDensity: val as FolderDensity })}
                                options={densityOptions} 
                            />
                        </div>

                        <div className="divider" />

                        <div>
                            <div className="text-sm font-bold mb-1">Organization Mode</div>
                            <p className="text-xs text-secondary mb-3">
                                {organizationOptions.find(option => option.value === settings.organizationMode)?.hint}
                            </p>
                            <CustomSelect 
                                value={settings.organizationMode} 
                                onChange={(val) => onSettingsChange({ organizationMode: val as OrganizationMode })}
                                options={organizationOptions}
                            />
                        </div>
                    </div>
                </section>

                <section>
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <Type size={16} className="text-accent" />
                        <h2 className="text-sm font-bold">Folder Naming</h2>
                    </div>
                    
                    <div className="card space-y-4">
                        <div>
                            <div className="text-sm font-bold mb-1">Naming Tone</div>
                            <p className="text-xs text-secondary mb-3">
                                {toneOptions.find(option => option.value === settings.namingTone)?.hint}
                            </p>
                            <CustomSelect 
                                value={settings.namingTone} 
                                onChange={(val) => onSettingsChange({ namingTone: val as NamingTone })}
                                options={toneOptions}
                            />
                        </div>

                        <div className="divider" />

                        <label htmlFor="emoji-toggle" className="flex items-start justify-between cursor-pointer group">
                            <div className="text-left pr-4">
                                <span className="text-sm font-bold">Use Emojis in Names</span>
                                <span className="block text-xs text-secondary mt-1 leading-relaxed">Adds emoji prefixes to AI generated folder names.</span>
                            </div>
                            <div className="toggle mt-0.5">
                                <input
                                    id="emoji-toggle"
                                    type="checkbox"
                                    checked={settings.useEmojiNames}
                                    onChange={(event) => onSettingsChange({ useEmojiNames: event.target.checked })}
                                />
                                <span className="toggle-track" />
                            </div>
                        </label>
                    </div>
                </section>

                <section>
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <Moon size={16} className="text-accent" />
                        <h2 className="text-sm font-bold">Appearance</h2>
                    </div>
                    
                    <div className="card">
                        <label htmlFor="theme-toggle" className="flex items-center justify-between cursor-pointer group">
                            <div>
                                <span className="text-sm font-bold">Dark Mode</span>
                                <span className="block text-xs text-secondary mt-1">Uses compact extension palette.</span>
                            </div>
                            <div className="toggle">
                                <input
                                    id="theme-toggle"
                                    type="checkbox"
                                    checked={theme === 'dark'}
                                    onChange={toggleTheme}
                                />
                                <span className="toggle-track" />
                            </div>
                        </label>
                    </div>
                </section>

            </div>
        </div>
    );
};

