import React, { useState } from "react";
import { BookmarkRootTitle } from "../lib/bookmarkImport";
import {
  collectFolderMoveOptions,
  FolderMoveOption,
} from "../lib/bookmarkStructure";

export interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
  parentId?: string | null;
  icon?: string; // Optional icon URL or class
  isSeparator?: boolean;
  nodeType?: "root" | "folder" | "bookmark";
  rootTitle?: BookmarkRootTitle;
  chromeId?: string;
  originalTitle?: string;
  isOverflow?: boolean;
  badgeLabel?: string;
  /** Top tokens from this folder's bookmarks; shown as a tooltip explaining why they were grouped. */
  keywords?: string[];
  /** Squared distance from this bookmark's embedding to its folder's centroid. */
  distanceToCentroid?: number;
  /** True for the farthest bookmarks in a folder — flagged so users can spot likely misplacements. */
  lowConfidence?: boolean;
  /** Backend cluster id for folder nodes — lets apply report back which Chrome folder a cluster became. */
  clusterId?: string;
  /** True when the bookmark's folder placement was manually confirmed and will survive future re-clustering. */
  pinned?: boolean;
}

interface BookmarkTreeProps {
  nodes: BookmarkNode[];
  defaultExpanded?: boolean;
  onRenameNode?: (nodeId: string, nextTitle: string) => void;
  onMoveBookmark?: (bookmarkId: string, targetFolderId: string) => void;
}

const INDENT_STEP_PX = 8;
const MAX_VISIBLE_DEPTH = 3;

const FolderIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
  </svg>
);

const FileIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <polyline points="10 9 9 9 8 9"></polyline>
  </svg>
);

const ChevronRight = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
);

const ChevronDown = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

const PencilIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>
  </svg>
);

const MoveToFolderIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 12h11"></path>
    <path d="m8 6 6 6-6 6"></path>
    <path d="M20 5v14"></path>
  </svg>
);

const cleanTitle = (title: string) => {
  return title
    .replace(/^["']|["']$/g, "")
    .replace(/\*\*/g, "")
    .trim();
};

const formatHost = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || url;
  }
};

const TreeNode: React.FC<{
  node: BookmarkNode;
  defaultExpanded: boolean;
  depth: number;
  onRenameNode?: (nodeId: string, nextTitle: string) => void;
  onMoveBookmark?: (bookmarkId: string, targetFolderId: string) => void;
  folderOptions: FolderMoveOption[];
}> = ({
  node,
  defaultExpanded,
  depth,
  onRenameNode,
  onMoveBookmark,
  folderOptions,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(node.title);
  const [isMovingBookmark, setIsMovingBookmark] = useState(false);

  React.useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  React.useEffect(() => {
    if (!isEditingTitle) setDraftTitle(node.title);
  }, [node.title, isEditingTitle]);

  if (node.isSeparator) {
    return (
      <div className="flex items-center gap-2 my-4 px-2 select-none opacity-80">
        <div className="h-px bg-white/20 flex-1"></div>
        <span className="text-xs font-semibold text-secondary uppercase tracking-widest">
          {node.title}
        </span>
        <div className="h-px bg-white/20 flex-1"></div>
      </div>
    );
  }

  const isContainer =
    node.nodeType === "root" ||
    node.nodeType === "folder" ||
    Boolean(node.children);
  const isRenamable =
    node.nodeType === "folder" || node.nodeType === "bookmark";
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const leftPadding = 6 + Math.min(depth, MAX_VISIBLE_DEPTH) * INDENT_STEP_PX;

  const toggle = () => {
    if (hasChildren) setIsExpanded(!isExpanded);
  };

  const startEditingTitle = () => {
    if (!isRenamable) return;
    setDraftTitle(node.title);
    setIsEditingTitle(true);
  };

  const commitRename = () => {
    setIsEditingTitle(false);
    if (!isRenamable) return;
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== node.title) {
      onRenameNode?.(node.id, trimmed);
    } else {
      setDraftTitle(node.title);
    }
  };

  const cancelRename = () => {
    setIsEditingTitle(false);
    if (!isRenamable) return;
    setDraftTitle(node.title);
  };

  const canMove = Boolean(onMoveBookmark) && !isContainer && Boolean(node.url);

  return (
    <div className="select-none">
      <div
        className={`tree-node ${isContainer ? "tree-folder" : "tree-link"}`}
        style={{ paddingLeft: `${leftPadding}px` }}
        onClick={hasChildren ? toggle : undefined}
        tabIndex={0}
        onKeyDown={(event) => {
          if (hasChildren && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            toggle();
          }
        }}
        title={
          isContainer && node.keywords && node.keywords.length > 0
            ? `Keywords: ${node.keywords.join(", ")}`
            : undefined
        }
      >
        {hasChildren ? (
          <span className="tree-chevron text-secondary">
            {isExpanded ? <ChevronDown /> : <ChevronRight />}
          </span>
        ) : (
          <span className="tree-chevron tree-chevron-spacer" />
        )}

        <span
          className={`tree-node-icon ${isContainer ? "text-primary" : "text-secondary"}`}
        >
          {isContainer ? <FolderIcon /> : <FileIcon />}
        </span>

        <div
          className={`tree-node-content ${isContainer ? "tree-folder-content" : "tree-link-content"}`}
        >
          {isEditingTitle && isRenamable ? (
            <input
              className="tree-title-input"
              value={draftTitle}
              autoFocus
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRename();
                }
              }}
            />
          ) : (
            <span
              className={`tree-title ${isContainer ? "tree-folder-title" : "tree-link-title"}`}
            >
              {cleanTitle(node.title)}
            </span>
          )}

          {node.badgeLabel && (
            <span
              className={`tree-badge ${node.isOverflow ? "tree-badge-warning" : ""}`}
            >
              {node.badgeLabel}
            </span>
          )}

          {!isContainer && node.lowConfidence && (
            <span
              className="tree-badge tree-badge-warning"
              title="This bookmark is more different from the rest of this folder — it might be misplaced."
            >
              Low confidence
            </span>
          )}

          {!isContainer && node.pinned && (
            <span
              className="tree-badge"
              title="You placed this bookmark here manually — future organizing runs will leave it alone."
            >
              Pinned
            </span>
          )}

          {!isContainer && node.url && !isEditingTitle && (
            <span className="tree-url-inline">{formatHost(node.url)}</span>
          )}
        </div>

        {!isEditingTitle && ((onRenameNode && isRenamable) || canMove) && (
          <div className="tree-actions">
            {onRenameNode && isRenamable && (
              <button
                type="button"
                className="tree-action-btn"
                title={isContainer ? "Rename folder" : "Rename bookmark"}
                onClick={(event) => {
                  event.stopPropagation();
                  startEditingTitle();
                }}
              >
                <PencilIcon />
              </button>
            )}

            {canMove &&
              (isMovingBookmark ? (
                <select
                  className="tree-move-select"
                  autoFocus
                  defaultValue=""
                  onClick={(event) => event.stopPropagation()}
                  onBlur={() => setIsMovingBookmark(false)}
                  onChange={(event) => {
                    const targetFolderId = event.target.value;
                    setIsMovingBookmark(false);
                    if (targetFolderId) {
                      onMoveBookmark?.(node.id, targetFolderId);
                    }
                  }}
                >
                  <option value="" disabled>
                    Move to…
                  </option>
                  {folderOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  className="tree-action-btn"
                  title="Move to another folder"
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsMovingBookmark(true);
                  }}
                >
                  <MoveToFolderIcon />
                </button>
              ))}
          </div>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div className="tree-children">
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              defaultExpanded={defaultExpanded}
              depth={depth + 1}
              onRenameNode={onRenameNode}
              onMoveBookmark={onMoveBookmark}
              folderOptions={folderOptions}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const BookmarkTree: React.FC<BookmarkTreeProps> = ({
  nodes,
  defaultExpanded = false,
  onRenameNode,
  onMoveBookmark,
}) => {
  const folderOptions = React.useMemo(
    () => (onMoveBookmark ? collectFolderMoveOptions(nodes) : []),
    [nodes, onMoveBookmark],
  );

  return (
    <div className="flex flex-col gap-1 overflow-y-auto flex-1 h-full min-h-0 pr-2 p-2">
      {nodes.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          defaultExpanded={defaultExpanded}
          depth={0}
          onRenameNode={onRenameNode}
          onMoveBookmark={onMoveBookmark}
          folderOptions={folderOptions}
        />
      ))}
    </div>
  );
};
