import React from "react";
import { RotateCcw, Undo2 } from "lucide-react";
import { ChromeApplyRecoveryState } from "../hooks/useChromeApply";

type ApplyRecoveryCardProps = {
  recovery: ChromeApplyRecoveryState;
};

const PHASE_LABELS: Record<string, string> = {
  folders: "Creating folders",
  bookmarks: "Moving bookmarks",
  cleanup: "Cleaning replaced root items",
  rollback: "Rolling back",
  complete: "Complete",
};

const formatUpdatedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export const ApplyRecoveryCard: React.FC<ApplyRecoveryCardProps> = ({
  recovery,
}) => {
  const journal = recovery.activeJournal;

  if (!journal && !recovery.message) {
    return null;
  }

  const rootLabel =
    journal?.plan.summary.rootTitles.join(", ") || "bookmark roots";
  const phaseLabel = journal
    ? PHASE_LABELS[journal.phase] || journal.phase
    : null;

  return (
    <section className="apply-recovery-card space-y-3">
      {journal ? (
        <>
          <div className="space-y-1">
            <div className="stat-row p-0">
              <p className="eyebrow">Unfinished apply</p>
              <span className="badge-count">{phaseLabel}</span>
            </div>
            <p className="screen-copy">
              Link Loom has a local apply journal for {rootLabel}. Choose how to
              recover before applying another structure.
            </p>
          </div>

          <div className="apply-recovery-meta">
            <span>{journal.entries.length} recorded changes</span>
            <span>Updated {formatUpdatedAt(journal.updatedAt)}</span>
          </div>

          {journal.errorMessage && (
            <div className="message message-error">{journal.errorMessage}</div>
          )}

          <div
            className="grid"
            style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            <button
              className="btn btn-primary"
              onClick={() => void recovery.resume()}
              disabled={recovery.isResolving || recovery.isLoading}
            >
              <RotateCcw size={15} />
              {recovery.isResolving ? "Working..." : "Resume"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => void recovery.rollback()}
              disabled={recovery.isResolving || recovery.isLoading}
            >
              <Undo2 size={15} />
              Roll Back
            </button>
          </div>
        </>
      ) : null}

      {recovery.message && (
        <div
          className={`message ${
            recovery.message.kind === "error"
              ? "message-error"
              : "message-success"
          }`}
        >
          {recovery.message.text}
        </div>
      )}
    </section>
  );
};
