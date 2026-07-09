import { createHash } from "crypto";
import OpenAI from "openai";
import { emojiPrefixLabel } from "../../lib/emojiNaming";
import { createLimit } from "../../lib/limit";
import { extractPrimaryDomainLabel, toTitleCase } from "../../lib/textLabels";
import { ClusteringSettings } from "../../lib/clusteringSettings";
import { supabase } from "../../db";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const parsePositiveInt = (raw: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(raw ?? `${fallback}`, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const CLUSTER_NAME_CONCURRENCY = parsePositiveInt(
  process.env.CLUSTER_NAME_CONCURRENCY,
  4,
);
const CLUSTER_NAME_MAX_RETRIES = parsePositiveInt(
  process.env.CLUSTER_NAME_MAX_RETRIES,
  5,
);
const CLUSTER_NAME_BASE_BACKOFF_MS = parsePositiveInt(
  process.env.CLUSTER_NAME_BASE_BACKOFF_MS,
  400,
);
const CLUSTER_NAME_MIN_BOOKMARKS_FOR_AI = parsePositiveInt(
  process.env.CLUSTER_NAME_MIN_BOOKMARKS_FOR_AI,
  12,
);
const CLUSTER_NAME_CONTEXT_SAMPLE_SIZE = parsePositiveInt(
  process.env.CLUSTER_NAME_CONTEXT_SAMPLE_SIZE,
  20,
);
const CLUSTER_NAME_CACHE_MAX_ENTRIES = parsePositiveInt(
  process.env.CLUSTER_NAME_CACHE_MAX_ENTRIES,
  256,
);
const CLUSTER_NAME_CACHE_TTL_MS = parsePositiveInt(
  process.env.CLUSTER_NAME_CACHE_TTL_MS,
  15 * 60 * 1000,
);

export const limitClusterNaming = createLimit(CLUSTER_NAME_CONCURRENCY);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// In-process only: survives warm Lambda/container reuse within one worker, but not
// cold starts or other instances. clusterNameCache dedupes repeated names with
// de-identified keys and bounded TTL/LRU retention; nextAllowedOpenAIRequestAt
// coordinates 429 backoff for concurrent naming calls in this process only. For
// cross-instance cache or rate limits, use an external store (e.g. Redis with TTL
// keys) or a distributed rate limiter.
class TtlLruCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V) {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }
}

const clusterNameCache = new TtlLruCache<string>(
  CLUSTER_NAME_CACHE_MAX_ENTRIES,
  CLUSTER_NAME_CACHE_TTL_MS,
);
let nextAllowedOpenAIRequestAt = 0;

const TITLE_TOKEN_STOP_WORDS = new Set([
  "and",
  "for",
  "the",
  "with",
  "from",
  "that",
  "this",
  "your",
  "you",
  "are",
  "how",
  "why",
  "what",
  "when",
  "where",
  "best",
  "guide",
  "tips",
  "new",
  "bookmark",
  "bookmarks",
  "folder",
  "page",
  "home",
  "official",
]);

const GENERIC_TITLES = new Set(["new folder", "untitled", "bookmark", ""]);
const GENERIC_RESPONSES = new Set([
  "new folder",
  "untitled",
  "bookmarks",
  "miscellaneous",
  "folder",
  "general",
  "",
]);

const sampleBookmarkIds = (
  bookmarkIds: string[],
  sampleSize: number,
): string[] => {
  if (bookmarkIds.length <= sampleSize) return bookmarkIds;

  const step = bookmarkIds.length / sampleSize;
  const sampled = new Set<string>();

  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.min(Math.floor(i * step), bookmarkIds.length - 1);
    sampled.add(bookmarkIds[idx]);
  }

  return Array.from(sampled);
};

const cleanClusterName = (name: string) =>
  name
    .replace(/^\s*["']|["']\s*$/g, "")
    .replace(/\*\*/g, "")
    .trim();

const getNamingToneInstruction = (settings: ClusteringSettings): string => {
  switch (settings.namingTone) {
    case "balanced":
      return "Tone: concise and modern. Slight personality is allowed, but keep the category obvious.";
    case "playful":
      return 'Tone: creative and witty, but keep findability high by including a clear topic anchor, ideally like "Creative Name (Topic)".';
    case "clear":
    default:
      return "Tone: clear and literal. Prefer obvious category labels over clever wording.";
  }
};

const finalizeClusterName = (
  name: string,
  settings: ClusteringSettings,
  contextText: string,
): string => {
  if (!settings.useEmojiNames) return name;
  return emojiPrefixLabel(name, contextText, "folder");
};

const buildClusterNameCacheKey = (
  settings: ClusteringSettings,
  rawContext: string,
): string => {
  const contextHash = createHash("sha256").update(rawContext).digest("hex");
  return `${settings.namingTone}|${settings.useEmojiNames ? "emoji" : "plain"}|${contextHash}`;
};

const CLUSTER_KEYWORD_LIMIT = 5;

/**
 * Top tokens across a group's bookmark titles/descriptions, ranked by
 * frequency. Persisted as `clusters.keywords` for explainability (tooltip
 * showing "why is this here?") and reused by the heuristic namer below.
 */
export const computeClusterKeywords = (
  bookmarks: Array<{
    title?: string | null;
    description?: string | null;
  }>,
  limit = CLUSTER_KEYWORD_LIMIT,
): string[] => {
  const tokenCounts = new Map<string, number>();

  for (const bookmark of bookmarks) {
    const combinedText =
      `${bookmark.title ?? ""} ${bookmark.description ?? ""}`.toLowerCase();
    const tokens = combinedText.match(/[a-z0-9]{3,}/g) ?? [];
    for (const token of tokens) {
      if (TITLE_TOKEN_STOP_WORDS.has(token)) continue;
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }
  }

  return Array.from(tokenCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([, count]) => count >= 2)
    .slice(0, limit)
    .map(([token]) => token);
};

const generateHeuristicClusterName = (
  bookmarks: Array<{
    title?: string | null;
    description?: string | null;
    url?: string | null;
  }>,
) => {
  const domainCounts = new Map<string, number>();
  for (const bookmark of bookmarks) {
    const domain = extractPrimaryDomainLabel(bookmark.url);
    if (domain) {
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }
  }

  const dominantDomain = Array.from(domainCounts.entries()).sort(
    (a, b) => b[1] - a[1],
  )[0];
  if (
    dominantDomain &&
    dominantDomain[1] >= Math.max(2, Math.ceil(bookmarks.length * 0.45))
  ) {
    return toTitleCase(dominantDomain[0]);
  }

  const topTokens = computeClusterKeywords(bookmarks, 2);
  if (topTokens.length > 0) {
    return toTitleCase(topTokens.join(" "));
  }

  if (dominantDomain) {
    return toTitleCase(dominantDomain[0]);
  }

  return "General";
};

const getRetryAfterMs = (err: any): number | null => {
  const retryAfterHeader =
    err?.headers?.["retry-after"] ?? err?.headers?.get?.("retry-after");

  if (!retryAfterHeader) return null;
  const parsed = Number.parseInt(retryAfterHeader, 10);
  if (Number.isNaN(parsed)) return null;
  return parsed * 1000;
};

export interface ClusterNamingResult {
  name: string;
  keywords: string[];
}

export async function generateClusterName(
  bookmarkIds: string[],
  settings: ClusteringSettings,
  log: (msg: string) => void,
  options: {
    sampledIds?: string[];
    suggestedName?: string;
    /** When false, skip the OpenAI call and use heuristic naming only. */
    allowAI?: boolean;
  } = {},
): Promise<ClusterNamingResult> {
  const sampledIds =
    options.sampledIds && options.sampledIds.length > 0
      ? options.sampledIds.slice(0, CLUSTER_NAME_CONTEXT_SAMPLE_SIZE)
      : sampleBookmarkIds(bookmarkIds, CLUSTER_NAME_CONTEXT_SAMPLE_SIZE);

  const { data: bks, error } = await supabase
    .from("bookmarks")
    .select("title, description, url")
    .in("id", sampledIds);

  if (error) {
    log(
      `Failed to load bookmarks for cluster naming (sampledIds=${sampledIds.length}): ${error.message}${error.code ? ` [${error.code}]` : ""}`,
    );
    return { name: "General", keywords: [] };
  }

  if (!bks || bks.length === 0) return { name: "General", keywords: [] };

  const meaningfulBookmarks = bks.filter((bookmark) => {
    const title = (bookmark.title || "").toLowerCase().trim();
    return title && !GENERIC_TITLES.has(title);
  });

  const bookmarkInfoList =
    meaningfulBookmarks.length > 0 ? meaningfulBookmarks : bks;
  const keywords = computeClusterKeywords(bookmarkInfoList);

  const contextLines = bookmarkInfoList
    .map((bookmark) => {
      const title = bookmark.title?.trim() || "";
      const description = bookmark.description?.trim() || "";
      const url = bookmark.url || "";

      let domain = "";
      try {
        domain = new URL(url).hostname.replace(/^www\./i, "");
      } catch {
        // ignored: best-effort extraction only
      }

      if (title && description) {
        return `- ${title}: ${description}`;
      }

      if (title) {
        return `- ${title}${domain ? ` (${domain})` : ""}`;
      }

      if (domain) {
        return `- ${domain}${description ? `: ${description}` : ""}`;
      }

      return null;
    })
    .filter((line): line is string => Boolean(line));
  const contextText = contextLines.join(" ");

  const suggestedName = options.suggestedName
    ? cleanClusterName(options.suggestedName)
    : "";
  if (suggestedName && !GENERIC_RESPONSES.has(suggestedName.toLowerCase())) {
    return {
      name: finalizeClusterName(suggestedName, settings, contextText),
      keywords,
    };
  }

  if (contextLines.length === 0) {
    const heuristicName = generateHeuristicClusterName(
      bks as Array<{
        title?: string | null;
        description?: string | null;
        url?: string | null;
      }>,
    );
    return {
      name: finalizeClusterName(heuristicName, settings, ""),
      keywords,
    };
  }

  const cacheKey = buildClusterNameCacheKey(
    settings,
    contextLines.join("\n").toLowerCase(),
  );
  const cachedName = clusterNameCache.get(cacheKey);
  if (cachedName) return { name: cachedName, keywords };

  if (
    options.allowAI === false ||
    bookmarkIds.length < CLUSTER_NAME_MIN_BOOKMARKS_FOR_AI ||
    !process.env.OPENAI_API_KEY
  ) {
    const heuristicName = generateHeuristicClusterName(
      bks as Array<{
        title?: string | null;
        description?: string | null;
        url?: string | null;
      }>,
    );
    const finalized = finalizeClusterName(heuristicName, settings, contextText);
    clusterNameCache.set(cacheKey, finalized);
    return { name: finalized, keywords };
  }

  const prompt = [
    "Generate a short, descriptive folder name for the bookmark group below.",
    getNamingToneInstruction(settings),
    "Constraints:",
    "- Return plain text only (no quotes, markdown, or numbering).",
    "- Keep it concise (max 5 words).",
    '- Avoid generic names like "New Folder" or "Miscellaneous".',
    "- The result must be easy to scan and find later.",
    "- If the bookmarks cover diverse topics, prioritize naming the most dominant topic rather than trying to combine disparate words.",
    "Bookmarks:",
    ...contextLines,
  ].join("\n");

  let retries = 0;

  while (retries < CLUSTER_NAME_MAX_RETRIES) {
    try {
      const waitForSharedWindow = Math.max(
        0,
        nextAllowedOpenAIRequestAt - Date.now(),
      );
      if (waitForSharedWindow > 0) {
        await delay(waitForSharedWindow);
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      });

      let name = "";
      if (Array.isArray(response.choices) && response.choices.length > 0) {
        name = response.choices[0].message.content?.trim() || "";
      } else {
        log("OpenAI cluster naming returned no choices");
      }
      name = cleanClusterName(name);

      if (!name || GENERIC_RESPONSES.has(name.toLowerCase())) {
        const heuristicName = generateHeuristicClusterName(
          bks as Array<{
            title?: string | null;
            description?: string | null;
            url?: string | null;
          }>,
        );
        const finalizedFallback = finalizeClusterName(
          heuristicName,
          settings,
          contextText,
        );
        clusterNameCache.set(cacheKey, finalizedFallback);
        return { name: finalizedFallback, keywords };
      }

      const finalized = finalizeClusterName(name, settings, contextText);
      clusterNameCache.set(cacheKey, finalized);
      return { name: finalized, keywords };
    } catch (e: any) {
      if (e.status === 429) {
        retries++;
        const retryAfterMs = getRetryAfterMs(e);
        const exponentialMs =
          CLUSTER_NAME_BASE_BACKOFF_MS * Math.pow(2, retries - 1);
        const jitterMs = Math.floor(Math.random() * 250);
        const wait = Math.max(retryAfterMs ?? 0, exponentialMs) + jitterMs;
        nextAllowedOpenAIRequestAt = Date.now() + wait;
        log(
          `OpenAI rate-limited cluster naming (attempt ${retries}/${CLUSTER_NAME_MAX_RETRIES}). Retrying in ${wait}ms...`,
        );
        await delay(wait);
        continue;
      }

      const namingErrorMessage =
        e instanceof Error
          ? e.message
          : typeof e?.message === "string"
            ? e.message
            : "unknown";
      const namingErrorStatus =
        typeof e?.status === "number" || typeof e?.status === "string"
          ? String(e.status)
          : "unknown";
      log(
        `OpenAI naming error: message=${namingErrorMessage}, status=${namingErrorStatus}`,
      );
      const heuristicName = generateHeuristicClusterName(
        bks as Array<{
          title?: string | null;
          description?: string | null;
          url?: string | null;
        }>,
      );
      return {
        name: finalizeClusterName(heuristicName, settings, contextText),
        keywords,
      };
    }
  }

  const heuristicName = generateHeuristicClusterName(
    bks as Array<{
      title?: string | null;
      description?: string | null;
      url?: string | null;
    }>,
  );
  return {
    name: finalizeClusterName(heuristicName, settings, contextText),
    keywords,
  };
}
