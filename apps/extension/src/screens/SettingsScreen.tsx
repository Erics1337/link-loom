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
                className="w-full flex items-center justify-between bg-[#0f172a]/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white/90 hover:text-white focus:outline-none focus:border-blue-500/50 transition-colors shadow-inner"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span>{selected.label}</span>
                <ChevronDown size={14} className={`text-secondary transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-[#0f172a]/95 border border-white/10 rounded-lg shadow-2xl overflow-hidden backdrop-blur-xl">
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                                option.value === value 
                                    ? 'bg-blue-500/20 text-blue-400 font-medium' 
                                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                            }`}
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
        <div className="flex flex-col h-full bg-primary relative">
            {/* Header */}
            <div className="flex items-center px-4 py-4 border-b border-white/5 bg-[#0f172a]/90 backdrop-blur-xl sticky top-0 z-10 shadow-sm">
                <button 
                    onClick={onBack} 
                    className="btn-icon h-[38px] w-[38px] bg-white/5 hover:bg-white/10 flex items-center justify-center flex-shrink-0 mr-3 rounded-xl transition-transform active:scale-95 shadow-sm"
                    title="Go Back"
                >
                    <ArrowLeft size={18} className="text-white/90" />
                </button>
                <h1 className="text-lg font-semibold text-white/90 tracking-tight">Settings</h1>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                
                {/* Clustering Section */}
                <section>
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <FolderTree size={16} className="text-blue-400" />
                        <h2 className="text-sm font-medium text-white/90">Clustering Behavior</h2>
                    </div>
                    
                    <div className="card bg-[#1e293b]/50 border border-white/5 p-4 space-y-5 rounded-xl">
                        <div>
                            <div className="text-sm font-medium text-white/90 block mb-1">Folder Density</div>
                            <p className="text-xs text-secondary mb-3">
                                {densityOptions.find(option => option.value === settings.folderDensity)?.hint}
                            </p>
                            <CustomSelect 
                                value={settings.folderDensity} 
                                onChange={(val) => onSettingsChange({ folderDensity: val as FolderDensity })}
                                options={densityOptions} 
                            />
                        </div>

                        <div className="w-full h-px bg-white/5 my-2"></div>

                        <div>
                            <div className="text-sm font-medium text-white/90 block mb-1">Organization Mode</div>
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

                {/* Naming Section */}
                <section>
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <Type size={16} className="text-purple-400" />
                        <h2 className="text-sm font-medium text-white/90">Folder Naming</h2>
                    </div>
                    
                    <div className="card bg-[#1e293b]/50 border border-white/5 p-4 space-y-5 rounded-xl">
                        <div>
                            <div className="text-sm font-medium text-white/90 block mb-1">Naming Tone</div>
                            <p className="text-xs text-secondary mb-3">
                                {toneOptions.find(option => option.value === settings.namingTone)?.hint}
                            </p>
                            <CustomSelect 
                                value={settings.namingTone} 
                                onChange={(val) => onSettingsChange({ namingTone: val as NamingTone })}
                                options={toneOptions}
                            />
                        </div>

                        <div className="w-full h-px bg-white/5 my-2"></div>

                        <label htmlFor="emoji-toggle" className="flex items-start justify-between cursor-pointer group">
                            <div className="text-left pr-4">
                                <span className="block text-sm font-medium text-white/90 group-hover:text-white transition-colors">Use Emojis in Names</span>
                                <span className="block text-xs text-secondary mt-1 leading-relaxed">Adds emoji prefixes to AI generated folder names.</span>
                            </div>
                            <div className="relative flex items-center h-5 mt-0.5">
                                <input
                                    id="emoji-toggle"
                                    type="checkbox"
                                    checked={settings.useEmojiNames}
                                    onChange={(event) => onSettingsChange({ useEmojiNames: event.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500 shadow-inner border border-white/5"></div>
                            </div>
                        </label>
                    </div>
                </section>

                {/* Appearance Section */}
                <section className="mb-8">
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <Moon size={16} className="text-slate-400" />
                        <h2 className="text-sm font-medium text-white/90">Appearance</h2>
                    </div>
                    
                    <div className="card bg-[#1e293b]/50 border border-white/5 p-4 rounded-xl">
                        <label htmlFor="theme-toggle" className="flex items-center justify-between cursor-pointer group">
                            <span className="block text-sm font-medium text-white/90 group-hover:text-white transition-colors">Dark Mode</span>
                            <div className="relative flex items-center h-5">
                                <input
                                    id="theme-toggle"
                                    type="checkbox"
                                    checked={theme === 'dark'}
                                    onChange={toggleTheme}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500 shadow-inner border border-white/5"></div>
                            </div>
                        </label>
                    </div>
                </section>

            </div>
        </div>
    );
};


