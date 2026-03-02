'use client';

import { useState } from 'react';

export interface FileNode {
  type: 'file' | 'folder';
  path?: string;
  name?: string;
  size?: number;
  mimeType?: string;
  children?: FileTree;
}

export interface FileTree {
  [key: string]: FileNode;
}

interface FileTreeProps {
  tree: FileTree;
  onSelectFile: (path: string) => void;
  selectedPath?: string;
}

export function FileTree({ tree, onSelectFile, selectedPath }: FileTreeProps) {
  return (
    <div className="text-sm">
      {Object.entries(tree).map(([name, node]) => (
        <TreeNode
          key={name}
          name={name}
          node={node}
          path={name}
          onSelectFile={onSelectFile}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
}

function TreeNode({
  name,
  node,
  path,
  onSelectFile,
  selectedPath,
  level = 0,
}: {
  name: string;
  node: FileNode;
  path: string;
  onSelectFile: (path: string) => void;
  selectedPath?: string;
  level?: number;
}) {
  const [expanded, setExpanded] = useState(level < 2); // 默认展开前两级

  if (node.type === 'folder') {
    return (
      <div>
        <div
          className={`flex items-center gap-1 px-2 py-1 hover:bg-gray-100 cursor-pointer ${
            expanded ? 'bg-gray-50' : ''
          }`}
          style={{ paddingLeft: `${level * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-gray-500">
            {expanded ? '📂' : '📁'}
          </span>
          <span className="text-gray-700 font-medium">{name}</span>
        </div>
        {expanded && node.children && (
          <div>
            {Object.entries(node.children).map(([childName, childNode]) => (
              <TreeNode
                key={childName}
                name={childName}
                node={childNode}
                path={`${path}/${childName}`}
                onSelectFile={onSelectFile}
                selectedPath={selectedPath}
                level={level + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  } else {
    const isSelected = selectedPath === node.path;
    const icon = getFileIcon(node.mimeType || '');
    
    return (
      <div
        className={`flex items-center gap-2 px-2 py-1 cursor-pointer ${
          isSelected
            ? 'bg-blue-100 text-blue-700'
            : 'hover:bg-gray-100 text-gray-700'
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => node.path && onSelectFile(node.path)}
      >
        <span>{icon}</span>
        <span className="flex-1 truncate">{name}</span>
        {node.size && (
          <span className="text-xs text-gray-400">
            {formatFileSize(node.size)}
          </span>
        )}
      </div>
    );
  }
}

function getFileIcon(mimeType: string): string {
  if (mimeType.includes('html')) return '🌐';
  if (mimeType.includes('css')) return '🎨';
  if (mimeType.includes('javascript')) return '📜';
  if (mimeType.includes('json')) return '📋';
  if (mimeType.includes('markdown')) return '📝';
  if (mimeType.includes('image')) return '🖼️';
  return '📄';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
