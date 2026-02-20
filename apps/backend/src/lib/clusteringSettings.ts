import { z } from 'zod';

export const folderDensitySchema = z.enum(['less', 'medium', 'more']);
export const namingToneSchema = z.enum(['clear', 'balanced', 'playful']);
export const organizationModeSchema = z.enum(['topic', 'category']);

export type FolderDensity = z.infer<typeof folderDensitySchema>;
export type NamingTone = z.infer<typeof namingToneSchema>;
export type OrganizationMode = z.infer<typeof organizationModeSchema>;

export interface ClusteringSettings {
    folderDensity: FolderDensity;
    namingTone: NamingTone;
    organizationMode: OrganizationMode;
    useEmojiNames: boolean;
}

export interface ClusteringDensityProfile {
    targetLeafSize: number;
    maxChildren: number;
    minChildSize: number;
}

export const DEFAULT_CLUSTERING_SETTINGS: ClusteringSettings = {
    folderDensity: 'medium',
    namingTone: 'clear',
    organizationMode: 'topic',
    useEmojiNames: false,
};

const clusteringSettingsSchema = z.object({
    folderDensity: folderDensitySchema.default(DEFAULT_CLUSTERING_SETTINGS.folderDensity),
    namingTone: namingToneSchema.default(DEFAULT_CLUSTERING_SETTINGS.namingTone),
    organizationMode: organizationModeSchema.default(DEFAULT_CLUSTERING_SETTINGS.organizationMode),
    useEmojiNames: z.boolean().default(DEFAULT_CLUSTERING_SETTINGS.useEmojiNames),
});

export const normalizeClusteringSettings = (input: unknown): ClusteringSettings => {
    const parsed = clusteringSettingsSchema.safeParse(input);
    if (parsed.success) return parsed.data;

    if (typeof input === 'object' && input !== null) {
        const partial = input as Partial<ClusteringSettings>;
        return {
            folderDensity: folderDensitySchema.catch(DEFAULT_CLUSTERING_SETTINGS.folderDensity).parse(partial.folderDensity),
            namingTone: namingToneSchema.catch(DEFAULT_CLUSTERING_SETTINGS.namingTone).parse(partial.namingTone),
            organizationMode: organizationModeSchema.catch(DEFAULT_CLUSTERING_SETTINGS.organizationMode).parse(partial.organizationMode),
            useEmojiNames: z.boolean().catch(DEFAULT_CLUSTERING_SETTINGS.useEmojiNames).parse(partial.useEmojiNames),
        };
    }

    return DEFAULT_CLUSTERING_SETTINGS;
};

export const getDensityProfile = (settings: ClusteringSettings): ClusteringDensityProfile => {
    switch (settings.folderDensity) {
        case 'less':
            return {
                targetLeafSize: 24,
                maxChildren: 3,
                minChildSize: 4,
            };
        case 'more':
            return {
                targetLeafSize: 8,
                maxChildren: 6,
                minChildSize: 2,
            };
        case 'medium':
        default:
            return {
                targetLeafSize: 14,
                maxChildren: 4,
                minChildSize: 3,
            };
    }
};
