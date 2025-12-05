import React, { useState } from 'react';

export interface BookmarkNode {
    id: string;
    title: string;
    url?: string;
    children?: BookmarkNode[];
    icon?: string; // Optional icon URL or class
}

interface BookmarkTreeProps {
    nodes: BookmarkNode[];
    defaultExpanded?: boolean;
}

const FolderIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>
);

const FileIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
    </svg>
);

const ChevronRight = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
);

const ChevronDown = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
);

const TreeNode: React.FC<{ node: BookmarkNode; defaultExpanded: boolean }> = ({ node, defaultExpanded }) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const hasChildren = node.children && node.children.length > 0;

    const toggle = () => {
        if (hasChildren) setIsExpanded(!isExpanded);
    };

    return (
        <div className="select-none">
            <div
                className={`flex items-center py-1 px-2 hover:bg-white/5 rounded cursor-pointer ${!hasChildren ? 'pl-6' : ''}`}
                onClick={toggle}
            >
                {hasChildren && (
                    <span className="mr-1 text-secondary">
                        {isExpanded ? <ChevronDown /> : <ChevronRight />}
                    </span>
                )}

                <span className="mr-2 text-secondary">
                    {hasChildren ? <FolderIcon /> : <FileIcon />}
                </span>

                <span className={`text-sm truncate ${hasChildren ? 'font-medium text-primary' : 'text-secondary'}`}>
                    {node.title}
                </span>

                {!hasChildren && node.url && (
                    <span className="ml-2 text-xs text-secondary opacity-50 truncate max-w-[150px]">
                        {node.url.replace(/^https?:\/\/(www\.)?/, '')}
                    </span>
                )}
            </div>

            {hasChildren && isExpanded && (
                <div className="pl-4 border-l border-white/10 ml-2">
                    {node.children!.map(child => (
                        <TreeNode key={child.id} node={child} defaultExpanded={defaultExpanded} />
                    ))}
                </div>
            )}
        </div>
    );
};

export const BookmarkTree: React.FC<BookmarkTreeProps> = ({ nodes, defaultExpanded = false }) => {
    return (
        <div className="flex flex-col gap-1 overflow-y-auto max-h-[300px] pr-2">
            {nodes.map(node => (
                <TreeNode key={node.id} node={node} defaultExpanded={defaultExpanded} />
            ))}
        </div>
    );
};
