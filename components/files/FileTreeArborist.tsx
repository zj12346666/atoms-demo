'use client';

import { Tree, NodeApi } from 'react-arborist';
import { FileNode } from '@/lib/file-tree-utils';
import { useRef, useEffect, useState } from 'react';

interface FileTreeArboristProps {
  data: FileNode[];
  onSelect: (node: FileNode | null) => void;
  selectedPath?: string;
}

export function FileTreeArborist({ data, onSelect, selectedPath }: FileTreeArboristProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    
    // 使用 ResizeObserver 监听容器尺寸变化
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateDimensions);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full">
      {dimensions.width > 0 && dimensions.height > 0 && (
        <Tree
          data={data}
          width={dimensions.width}
          height={dimensions.height}
          indent={20}
          rowHeight={28}
          onSelect={(nodes: NodeApi<FileNode>[]) => {
            const node = nodes[0];
            if (node && node.data.type === 'file') {
              onSelect(node.data);
            } else {
              onSelect(null);
            }
          }}
          selectedIds={selectedPath ? [selectedPath] : []}
        >
        {({ style, node, dragHandle }) => (
          <div
            ref={dragHandle}
            style={style}
            className={`flex items-center gap-2 px-2 py-1 hover:bg-gray-100 cursor-pointer ${
              node.isSelected ? 'bg-blue-100 text-blue-700' : 'text-gray-700'
            }`}
          >
            <span className="text-gray-500">
              {node.isLeaf ? (
                <FileIcon mimeType={node.data.mimeType} />
              ) : (
                node.isOpen ? '📂' : '📁'
              )}
            </span>
            <span className="flex-1 truncate text-sm">{node.data.name}</span>
            {node.data.size && (
              <span className="text-xs text-gray-400">
                {formatFileSize(node.data.size)}
              </span>
            )}
          </div>
        )}
        </Tree>
      )}
    </div>
  );
}

function FileIcon({ mimeType }: { mimeType?: string }) {
  if (!mimeType) return '📄';
  
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
