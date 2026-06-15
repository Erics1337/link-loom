export type FolderDensity = 'less' | 'medium' | 'more';
export type NamingTone = 'clear' | 'balanced' | 'playful';

export interface ClusteringSettings {
    folderDensity: FolderDensity;
    namingTone: NamingTone;
    useEmojiNames: boolean;
}

export const CLUSTERING_SETTINGS_STORAGE_KEY = 'clusteringSettings';

export const DEFAULT_CLUSTERING_SETTINGS: ClusteringSettings = {
    folderDensity: 'medium',
    namingTone: 'clear',
    useEmojiNames: false,
};

const isFolderDensity = (value: unknown): value is FolderDensity =>
    value === 'less' || value === 'medium' || value === 'more';

const isNamingTone = (value: unknown): value is NamingTone =>
    value === 'clear' || value === 'balanced' || value === 'playful';

export const normalizeClusteringSettings = (value: unknown): ClusteringSettings => {
    if (!value || typeof value !== 'object') {
        return DEFAULT_CLUSTERING_SETTINGS;
    }

    const input = value as Partial<ClusteringSettings>;

    return {
        folderDensity: isFolderDensity(input.folderDensity)
            ? input.folderDensity
            : DEFAULT_CLUSTERING_SETTINGS.folderDensity,
        namingTone: isNamingTone(input.namingTone)
            ? input.namingTone
            : DEFAULT_CLUSTERING_SETTINGS.namingTone,
        useEmojiNames: typeof input.useEmojiNames === 'boolean'
            ? input.useEmojiNames
            : DEFAULT_CLUSTERING_SETTINGS.useEmojiNames,
    };
};
