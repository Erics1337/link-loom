import { beforeEach, describe, expect, it, vi } from "vitest";

import { splitClusterGroups } from "../clusterAlgorithm";
import { ClusteringSettings } from "../../../lib/clusteringSettings";

const { mockKmeans } = vi.hoisted(() => ({ mockKmeans: vi.fn() }));

vi.mock("ml-kmeans", () => ({
  kmeans: mockKmeans,
}));

const settings: ClusteringSettings = {
  folderDensity: "more",
  namingTone: "clear",
  useEmojiNames: false,
};

describe("clusterAlgorithm", () => {
  beforeEach(() => {
    mockKmeans.mockReset();
  });

  it("moves clear vector outliers to the closest sibling group after k-means", () => {
    mockKmeans.mockReturnValue({
      clusters: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
    });

    const groups = splitClusterGroups({
      bookmarkIds: ["a", "b", "c", "d", "outlier", "f", "g", "h", "i", "j"],
      vectors: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [10, 10],
        [10, 10],
        [10, 10],
        [10, 10],
        [10, 10],
        [10, 10],
      ],
      settings,
      log: vi.fn(),
    });

    expect(groups).toHaveLength(2);
    expect(groups?.[0].ids).not.toContain("outlier");
    expect(groups?.[1].ids).toContain("outlier");
  });

  it("does not move outliers when the source group would drop below minimum size", () => {
    mockKmeans.mockReturnValue({
      clusters: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
    });

    const groups = splitClusterGroups({
      bookmarkIds: ["a", "outlier", "c", "d", "e", "f", "g", "h", "i", "j"],
      vectors: [
        [0, 0],
        [10, 10],
        [10, 10],
        [10, 10],
        [10, 10],
        [10, 10],
        [10, 10],
        [10, 10],
        [10, 10],
        [10, 10],
      ],
      settings,
      log: vi.fn(),
    });

    expect(groups).toHaveLength(2);
    expect(groups?.[0].ids).toEqual(["a", "outlier"]);
  });
});
