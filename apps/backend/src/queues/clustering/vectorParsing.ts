const VECTOR_NORM_EPSILON = 1e-10;

export const normalizeVector = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm <= VECTOR_NORM_EPSILON) return vector;
  return vector.map((value) => value / norm);
};

export const parseVector = (
  raw: unknown,
  onParseError?: (error: unknown) => void,
): number[] | null => {
  let candidate: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw);
    } catch (e) {
      onParseError?.(e);
      return null;
    }
  }

  if (!Array.isArray(candidate) || candidate.length === 0) return null;

  const values: number[] = [];
  for (const value of candidate) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    values.push(value);
  }

  return values;
};

export const getJoinedSharedVector = (joined: unknown): unknown => {
  if (!joined) return null;
  if (Array.isArray(joined)) {
    if (joined.length === 0) return null;
    const first = joined[0] as { vector?: unknown };
    return first?.vector ?? null;
  }

  if (typeof joined === "object") {
    return (joined as { vector?: unknown }).vector ?? null;
  }

  return null;
};

export const parseBookmarkVector = (
  joined: unknown,
  onParseError?: (error: unknown) => void,
): number[] | null => parseVector(getJoinedSharedVector(joined), onParseError);
