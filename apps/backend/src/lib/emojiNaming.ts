const KEYWORD_EMOJI_RULES: Array<{ emoji: string; keywords: string[] }> = [
  {
    emoji: "💻",
    keywords: [
      "code",
      "coding",
      "programming",
      "developer",
      "javascript",
      "typescript",
      "python",
      "api",
      "backend",
      "frontend",
      "software",
    ],
  },
  {
    emoji: "🤖",
    keywords: ["ai", "llm", "machine learning", "openai", "neural", "model"],
  },
  {
    emoji: "🛒",
    keywords: ["shop", "shopping", "store", "buy", "cart", "product", "amazon"],
  },
  {
    emoji: "💰",
    keywords: [
      "finance",
      "money",
      "invest",
      "stock",
      "crypto",
      "bank",
      "budget",
    ],
  },
  {
    emoji: "📚",
    keywords: [
      "learn",
      "learning",
      "tutorial",
      "docs",
      "documentation",
      "course",
      "guide",
      "book",
    ],
  },
  {
    emoji: "🎨",
    keywords: ["design", "ui", "ux", "figma", "color", "typography"],
  },
  { emoji: "🎬", keywords: ["video", "youtube", "movie", "film", "watch"] },
  { emoji: "🎵", keywords: ["music", "song", "playlist", "audio"] },
  { emoji: "✈️", keywords: ["travel", "trip", "flight", "hotel", "vacation"] },
  { emoji: "🍳", keywords: ["food", "recipe", "cook", "kitchen"] },
  { emoji: "🏋️", keywords: ["fitness", "health", "workout", "gym"] },
  { emoji: "🔒", keywords: ["security", "privacy", "auth", "encryption"] },
  {
    emoji: "☁️",
    keywords: ["cloud", "aws", "gcp", "azure", "kubernetes", "docker"],
  },
  { emoji: "📰", keywords: ["news", "article", "blog", "post"] },
  { emoji: "💼", keywords: ["career", "job", "work", "resume", "interview"] },
  { emoji: "🧰", keywords: ["tool", "utility", "kit"] },
  { emoji: "🎮", keywords: ["game", "gaming"] },
  {
    emoji: "📊",
    keywords: ["data", "analytics", "metrics", "dashboard", "report"],
  },
];

const KNOWN_EMOJIS = Array.from(
  new Set(KEYWORD_EMOJI_RULES.map((rule) => rule.emoji).concat(["📁", "🔖"])),
);

const clean = (value: string | null | undefined) =>
  (value ?? "")
    .replace(/^\s*["']|["']\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const hasLeadingEmoji = (value: string) => {
  if (KNOWN_EMOJIS.some((emoji) => value.startsWith(emoji))) {
    return true;
  }

  const codePoint = value.codePointAt(0);
  if (!codePoint) return false;
  return codePoint >= 0x2600;
};

const pickEmoji = (text: string, fallback: string): string => {
  const normalized = text.toLowerCase();

  for (const rule of KEYWORD_EMOJI_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.emoji;
    }
  }

  return fallback;
};

export const emojiPrefixLabel = (
  rawLabel: string | null | undefined,
  context: string,
  type: "folder" | "bookmark",
): string => {
  const label = clean(rawLabel);
  if (!label) return label;
  if (hasLeadingEmoji(label)) return label;

  const fallback = type === "folder" ? "📁" : "🔖";
  const emoji = pickEmoji(`${label} ${context}`, fallback);

  return `${emoji} ${label}`.trim();
};
