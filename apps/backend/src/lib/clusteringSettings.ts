import { z } from "zod";

export const folderDensitySchema = z.enum(["less", "medium", "more"]);
export const namingToneSchema = z.enum(["clear", "balanced", "playful"]);

export type FolderDensity = z.infer<typeof folderDensitySchema>;
export type NamingTone = z.infer<typeof namingToneSchema>;

export interface ClusteringSettings {
  folderDensity: FolderDensity;
  namingTone: NamingTone;
  useEmojiNames: boolean;
}

export interface ClusteringDensityProfile {
  targetLeafSize: number;
  maxChildren: number;
  minChildSize: number;
  /** Maximum folder nesting depth; the final level fans out flat instead of recursing. */
  maxDepth: number;
}

export const DEFAULT_CLUSTERING_SETTINGS: ClusteringSettings = {
  folderDensity: "medium",
  namingTone: "clear",
  useEmojiNames: false,
};

const clusteringSettingsSchema = z.object({
  folderDensity: folderDensitySchema.default(
    DEFAULT_CLUSTERING_SETTINGS.folderDensity,
  ),
  namingTone: namingToneSchema.default(DEFAULT_CLUSTERING_SETTINGS.namingTone),
  useEmojiNames: z.boolean().default(DEFAULT_CLUSTERING_SETTINGS.useEmojiNames),
});

export const normalizeClusteringSettings = (
  input: unknown,
): ClusteringSettings => {
  const parsed = clusteringSettingsSchema.safeParse(input);
  if (parsed.success) return parsed.data;

  if (typeof input === "object" && input !== null) {
    const partial = input as Partial<ClusteringSettings>;
    return {
      folderDensity: folderDensitySchema
        .catch(DEFAULT_CLUSTERING_SETTINGS.folderDensity)
        .parse(partial.folderDensity),
      namingTone: namingToneSchema
        .catch(DEFAULT_CLUSTERING_SETTINGS.namingTone)
        .parse(partial.namingTone),
      useEmojiNames: z
        .boolean()
        .catch(DEFAULT_CLUSTERING_SETTINGS.useEmojiNames)
        .parse(partial.useEmojiNames),
    };
  }

  return DEFAULT_CLUSTERING_SETTINGS;
};

export const getDensityProfile = (
  settings: ClusteringSettings,
): ClusteringDensityProfile => {
  switch (settings.folderDensity) {
    case "less":
      return {
        targetLeafSize: 24,
        maxChildren: 3,
        minChildSize: 4,
        maxDepth: 2,
      };
    case "more":
      return {
        targetLeafSize: 8,
        maxChildren: 6,
        minChildSize: 2,
        maxDepth: 4,
      };
    case "medium":
    default:
      return {
        targetLeafSize: 14,
        maxChildren: 4,
        minChildSize: 3,
        maxDepth: 3,
      };
  }
};
