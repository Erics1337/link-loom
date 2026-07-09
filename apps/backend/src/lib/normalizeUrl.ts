const TRACKING_PARAM_NAMES = new Set([
  "gclid",
  "dclid",
  "wbraid",
  "gbraid",
  "fbclid",
  "msclkid",
  "twclid",
  "igshid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "s_kwcid",
  "_hsenc",
  "_hsmi",
]);

const isTrackingParam = (name: string) => {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAM_NAMES.has(lower);
};

/**
 * Canonicalizes a bookmark URL before hashing so tracking-param and host-case
 * variants of the same page share one shared_links cache entry.
 *
 * Mirrored in apps/extension/src/lib/bookmarkStructure.ts (normalizeBookmarkUrl);
 * every sha256 used as a shared_links id must go through this first.
 */
const cleanHash = (hash: string): string => {
  if (!hash) return "";

  // Split the hash into path and query if there is a '?'
  const questionMarkIndex = hash.indexOf("?");
  const hashPath =
    questionMarkIndex !== -1 ? hash.slice(0, questionMarkIndex) : hash;
  const hashQuery =
    questionMarkIndex !== -1 ? hash.slice(questionMarkIndex + 1) : "";

  // 1. Process the query part of the hash if it exists
  let cleanedQuery = "";
  if (hashQuery) {
    const queryParams = new URLSearchParams(hashQuery);
    const keptQueryParams = Array.from(queryParams.entries()).filter(
      ([name]) => !isTrackingParam(name),
    );
    if (keptQueryParams.length > 0) {
      keptQueryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      cleanedQuery = "?" + new URLSearchParams(keptQueryParams).toString();
    }
  }

  // 2. Check if the path part of the hash is itself a tracking fragment.
  // e.g. #utm_source=twitter or #xtor=AD-308 or #gclid=123
  const cleanPath = hashPath.startsWith("#") ? hashPath.slice(1) : hashPath;

  let isTrackingPath = false;
  if (isTrackingParam(cleanPath)) {
    isTrackingPath = true;
  } else {
    try {
      const pathParams = new URLSearchParams(cleanPath);
      const keys = Array.from(pathParams.keys());
      if (keys.length > 0 && keys.every((key) => isTrackingParam(key))) {
        isTrackingPath = true;
      }
    } catch {
      // ignore
    }
  }

  if (isTrackingPath) {
    return "";
  }

  const finalPath = hashPath.startsWith("#") ? hashPath.slice(1) : hashPath;
  return finalPath + cleanedQuery;
};

export const normalizeBookmarkUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    parsed.hash = cleanHash(parsed.hash);
    const keptParams = Array.from(parsed.searchParams.entries()).filter(
      ([name]) => !isTrackingParam(name),
    );
    keptParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    parsed.search = new URLSearchParams(keptParams).toString();
    if (parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url.trim();
  }
};
