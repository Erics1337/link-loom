import { ClusteringSettings } from "./clusteringSettings";
import { StructureAssignment } from "./bookmarkStructure";

export type WeavingProgress = {
  pending: number;
  pendingRaw: number;
  enriched: number;
  embedded: number;
  errored: number;
  processing: number;
  remainingToAssign: number;
  clusters: number;
  assigned: number;
  total: number;
  isIngesting: boolean;
  ingestProcessed: number;
  ingestTotal: number;
  isClusteringActive: boolean;
};

export type StatusResponse = WeavingProgress & {
  isDone?: boolean;
  isPremium?: boolean;
  pipelineRunId?: string | null;
  pipelineGeneration?: number | null;
  pipelineStatus?:
    | "running"
    | "cancelled"
    | "completed"
    | "failed"
    | string
    | null;
};

export type BookmarkSearchResult = {
  id: string;
  url: string;
  title: string;
  description: string | null;
  similarity: number;
};

type ClientOptions = {
  backendUrl: string;
  buildAuthHeaders: (tokenOverride?: string) => Record<string, string>;
  getAuthHeaders: () => Record<string, string>;
};

export class StructureClient {
  constructor(private readonly options: ClientOptions) {}

  private postHeaders(tokenOverride?: string): Record<string, string> {
    return {
      ...this.options.buildAuthHeaders(tokenOverride),
      "Content-Type": "application/json",
    };
  }

  async getStatus(userId: string) {
    const response = await fetch(
      `${this.options.backendUrl}/status/${userId}`,
      {
        headers: this.options.getAuthHeaders(),
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const detail = body ? `: ${body}` : "";
      throw new Error(
        `Status request failed (${response.status} ${response.statusText})${detail}`,
      );
    }
    return response.json() as Promise<StatusResponse>;
  }

  async ingest(input: {
    bookmarks: Array<{
      id: string;
      url: string;
      title: string;
      parentId?: string;
      parentTitle?: string;
    }>;
    clusteringSettings: ClusteringSettings;
    accessToken?: string;
  }) {
    return fetch(`${this.options.backendUrl}/ingest`, {
      method: "POST",
      headers: this.postHeaders(input.accessToken),
      body: JSON.stringify({
        bookmarks: input.bookmarks,
        clusteringSettings: input.clusteringSettings,
      }),
    });
  }

  async confirmApply(
    userId: string,
    folderChromeIds: Array<{ clusterId: string; chromeFolderId: string }>,
  ) {
    return fetch(`${this.options.backendUrl}/confirm-apply/${userId}`, {
      method: "POST",
      headers: this.postHeaders(),
      body: JSON.stringify({ folderChromeIds }),
    });
  }

  async triggerClustering(
    userId: string,
    clusteringSettings: ClusteringSettings,
  ) {
    return fetch(`${this.options.backendUrl}/trigger-clustering/${userId}`, {
      method: "POST",
      headers: this.postHeaders(),
      body: JSON.stringify({ clusteringSettings }),
    });
  }

  async fetchStructure(userId: string, signal?: AbortSignal) {
    return fetch(`${this.options.backendUrl}/structure/${userId}`, {
      signal,
      headers: this.options.getAuthHeaders(),
    });
  }

  async scanDeadLinks(
    assignments: StructureAssignment[],
    signal?: AbortSignal,
  ) {
    return fetch(`${this.options.backendUrl}/dead-links/check`, {
      method: "POST",
      headers: this.postHeaders(),
      signal,
      body: JSON.stringify({
        bookmarks: assignments.map((assignment) => ({
          chromeId: assignment.chromeId,
          url: assignment.url,
        })),
      }),
    });
  }

  async autoRename(
    userId: string,
    clusteringSettings: ClusteringSettings,
    signal?: AbortSignal,
  ) {
    return fetch(`${this.options.backendUrl}/auto-rename/${userId}`, {
      method: "POST",
      headers: this.postHeaders(),
      signal,
      body: JSON.stringify({ clusteringSettings }),
    });
  }

  async search(query: string): Promise<BookmarkSearchResult[]> {
    const response = await fetch(`${this.options.backendUrl}/search`, {
      method: "POST",
      headers: this.postHeaders(),
      body: JSON.stringify({ query }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error || `Search failed (${response.status})`);
    }
    const data = (await response.json()) as {
      results?: BookmarkSearchResult[];
    };
    return data.results ?? [];
  }

  async cancel(userId: string) {
    return fetch(`${this.options.backendUrl}/cancel/${userId}`, {
      method: "POST",
      headers: this.postHeaders(),
    });
  }
}
