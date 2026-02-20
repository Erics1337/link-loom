import { useEffect, useState } from 'react';
import {
    CLUSTERING_SETTINGS_STORAGE_KEY,
    ClusteringSettings,
    DEFAULT_CLUSTERING_SETTINGS,
    normalizeClusteringSettings,
} from '../lib/clusteringSettings';

export const useClusteringSettings = () => {
    const [settings, setSettings] = useState<ClusteringSettings>(DEFAULT_CLUSTERING_SETTINGS);

    useEffect(() => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.get([CLUSTERING_SETTINGS_STORAGE_KEY], (result) => {
                setSettings(normalizeClusteringSettings(result[CLUSTERING_SETTINGS_STORAGE_KEY]));
            });
            return;
        }

        const raw = localStorage.getItem(CLUSTERING_SETTINGS_STORAGE_KEY);
        if (!raw) return;

        try {
            setSettings(normalizeClusteringSettings(JSON.parse(raw)));
        } catch {
            setSettings(DEFAULT_CLUSTERING_SETTINGS);
        }
    }, []);

    useEffect(() => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({ [CLUSTERING_SETTINGS_STORAGE_KEY]: settings });
            return;
        }

        localStorage.setItem(CLUSTERING_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }, [settings]);

    const updateSettings = (next: Partial<ClusteringSettings>) => {
        setSettings(prev => normalizeClusteringSettings({ ...prev, ...next }));
    };

    return {
        settings,
        setSettings,
        updateSettings,
    };
};
