import { describe, expect, it } from "vitest";
import { functionBlockFromSql, readMigrationSql } from "./sqlTestUtils";

const pipelineSql = readMigrationSql(
  "20260529015619_add_pipeline_job_generation.sql",
);

describe("pipeline run SQL migrations", () => {
  it("links bookmarks to pipeline runs for run-scoped readiness checks", () => {
    expect(pipelineSql).toContain(
      "ADD COLUMN IF NOT EXISTS pipeline_run_id UUID REFERENCES public.pipeline_runs(id)",
    );
    expect(pipelineSql).toContain("idx_bookmarks_pipeline_run_status");
  });

  it("claims clustering only after bookmarks for the current run are terminal", () => {
    const block = functionBlockFromSql(
      pipelineSql,
      "claim_user_pipeline_clustering",
    );
    expect(block).toContain("current_run public.pipeline_runs%ROWTYPE;");
    expect(block).toContain("WHERE id = control_row.current_pipeline_run_id");
    expect(block).toContain("current_run.totals->>'terminalBookmarks'");
    expect(block).toContain("AND status = 'running'");
    expect(block).toContain("current_run.totals->>'ingestCompletedAt' IS NULL");
    expect(block).toContain(
      "current_run.totals->>'clusteringEnqueuedAt' IS NOT NULL",
    );
    expect(block).toContain("current_run.totals->>'total'");
    expect(block).toContain("current_run.totals->>'untrackedErrors'");
    expect(block).toContain("RETURN NULL;");
    expect(block).not.toMatch(
      /WHERE\s+user_id\s*=\s*p_user_id\s+AND\s+status\s+IN/i,
    );
  });

  it("stages terminal bookmark counters idempotently on pipeline runs", () => {
    expect(pipelineSql).toContain("pipeline_run_terminal_bookmarks");
    expect(pipelineSql).toContain("UNIQUE (pipeline_run_id, bookmark_id)");
    expect(pipelineSql).toContain("'terminalBookmarks', 0");

    const block = functionBlockFromSql(
      pipelineSql,
      "record_user_pipeline_bookmark_terminal",
    );
    expect(block).toContain(
      "ON CONFLICT (pipeline_run_id, bookmark_id) DO NOTHING",
    );
    expect(block).toContain("GET DIAGNOSTICS inserted_count = ROW_COUNT");
    expect(block).toContain("already_recorded BOOLEAN := FALSE;");
    expect(block).toContain("IF NOT already_recorded THEN");
    expect(block).toContain("status IN ('embedded', 'error')");
    expect(block).toContain("totals->>'terminalBookmarks'");
    expect(block).toContain(
      "RETURN (terminal_count + untracked_error_count) >= total_bookmarks;",
    );
  });

  it("records clustering enqueue only after the coordinator queues the job", () => {
    const claimBlock = functionBlockFromSql(
      pipelineSql,
      "claim_user_pipeline_clustering",
    );
    const enqueuedBlock = functionBlockFromSql(
      pipelineSql,
      "record_user_pipeline_clustering_enqueued",
    );
    const releaseBlock = functionBlockFromSql(
      pipelineSql,
      "release_user_pipeline_clustering_claim",
    );

    expect(claimBlock).not.toContain(
      "jsonb_build_object('clusteringEnqueuedAt', NOW())",
    );
    expect(claimBlock).toContain("RETURNS UUID");
    expect(claimBlock).toContain("claim_id := gen_random_uuid();");
    expect(claimBlock).toContain("'clusteringClaimedAt', NOW()");
    expect(claimBlock).toContain("'clusteringClaimId', claim_id");
    expect(claimBlock).toContain("RETURN claim_id;");
    expect(claimBlock).toContain(
      "current_run.totals->>'clusteringClaimedAt' IS NOT NULL",
    );
    expect(enqueuedBlock).toContain(
      "jsonb_build_object('clusteringEnqueuedAt', NOW())",
    );
    expect(enqueuedBlock).toContain(
      "totals - 'clusteringClaimedAt' - 'clusteringClaimId'",
    );
    expect(enqueuedBlock).toContain(
      "totals->>'clusteringClaimId' = p_claim_id::text",
    );
    expect(enqueuedBlock).toContain("totals->>'clusteringEnqueuedAt' IS NULL");
    expect(releaseBlock).toContain(
      "totals - 'clusteringClaimedAt' - 'clusteringClaimId'",
    );
    expect(releaseBlock).toContain(
      "totals->>'clusteringClaimId' = p_claim_id::text",
    );
    expect(releaseBlock).toContain("totals->>'clusteringEnqueuedAt' IS NULL");
  });

  it("keeps run telemetry out of user pipeline controls", () => {
    expect(pipelineSql).toContain(
      "current_pipeline_run_id UUID REFERENCES public.pipeline_runs(id)",
    );
    expect(pipelineSql).not.toContain(
      "ADD COLUMN IF NOT EXISTS total_bookmarks INTEGER",
    );
    expect(pipelineSql).not.toContain(
      "ADD COLUMN IF NOT EXISTS untracked_error_count INTEGER",
    );
    expect(pipelineSql).not.toContain(
      "ADD COLUMN IF NOT EXISTS clustering_settings JSONB",
    );
    expect(pipelineSql).toContain("DROP COLUMN IF EXISTS total_bookmarks");

    const untrackedBlock = functionBlockFromSql(
      pipelineSql,
      "record_user_pipeline_untracked_error",
    );
    const claimBlock = functionBlockFromSql(
      pipelineSql,
      "claim_user_pipeline_clustering",
    );
    expect(untrackedBlock).not.toContain(
      "UPDATE public.user_pipeline_controls",
    );
    expect(claimBlock).not.toContain("SET clustering_enqueued_at");
  });

  it("deduplicates untracked errors by run and error key", () => {
    expect(pipelineSql).toContain("pipeline_run_untracked_errors");
    const block = functionBlockFromSql(
      pipelineSql,
      "record_user_pipeline_untracked_error",
    );
    expect(block).toContain("p_error_key TEXT DEFAULT NULL");
    expect(block).toContain(
      "ON CONFLICT (user_id, job_generation, error_key) DO NOTHING",
    );
    expect(block).toContain("IF inserted_count = 0 THEN");
    expect(block).toContain("RETURN;");
  });

  it("preserves accumulated run telemetry when completing a run", () => {
    const block = functionBlockFromSql(pipelineSql, "complete_pipeline_run");
    expect(block).toContain(
      "totals = totals || COALESCE(p_totals, '{}'::jsonb)",
    );
  });

  it("scopes status bookmark and assignment counts to a pipeline run", () => {
    const block = functionBlockFromSql(
      pipelineSql,
      "get_pipeline_run_status_counts",
    );

    expect(block).toContain("COUNT(*) FILTER (WHERE status =");
    expect(block).toContain("AND pipeline_run_id = p_pipeline_run_id");
    expect(block).toContain(
      "COUNT(DISTINCT ca.bookmark_id) AS assigned_bookmarks",
    );
    expect(block).toContain("JOIN public.bookmarks b ON b.id = ca.bookmark_id");
    expect(block).toContain("b.pipeline_run_id = p_pipeline_run_id");
    expect(block).toContain("FROM public.clusters");
    expect(block).toContain("WHERE user_id = p_user_id");
    expect(pipelineSql).toContain(
      "REVOKE ALL ON FUNCTION public.get_pipeline_run_status_counts(UUID, UUID) FROM PUBLIC, anon, authenticated",
    );
    expect(pipelineSql).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_pipeline_run_status_counts(UUID, UUID) TO service_role",
    );
  });
});
