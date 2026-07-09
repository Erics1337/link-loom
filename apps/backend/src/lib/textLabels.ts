import { parse as parsePublicSuffix } from "psl";

const fallbackPrimaryLabel = (hostname: string): string | null => {
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return parts[parts.length - 2];
};

export const toTitleCase = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const extractPrimaryDomainLabel = (
  rawUrl: string | null | undefined,
): string | null => {
  if (!rawUrl) return null;
  try {
    const hostname = new URL(rawUrl).hostname.replace(/^www\./i, "");
    const parsed = parsePublicSuffix(hostname);
    if (!("error" in parsed) && parsed.sld) {
      return parsed.sld;
    }
    return fallbackPrimaryLabel(hostname);
  } catch {
    return null;
  }
};
