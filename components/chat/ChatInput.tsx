'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '../ui/Button';

interface UploadedImage {
  /** 本地预览 URL（blob: 或 data:），上传完成前使用 */
  preview: string;
  /** 服务端返回的持久化 URL，上传成功后使用 */
  url?: string;
  uploading: boolean;
  error?: string;
}

interface ChatInputProps {
  onSend: (content: string, imageUrls?: string[]) => void;
  sessionId?: string;
  projectId?: string;
  disabled?: boolean;
}

export function ChatInput({ onSend, sessionId, projectId, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<UploadedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadImage = useCallback(async (dataUrl: string, mimeType: string): Promise<string> => {
    const res = await fetch('/api/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, mimeType, sessionId, projectId }),
    });
    if (!res.ok) throw new Error('图片上传失败');
    const { url } = await res.json();
    return url as string;
  }, [sessionId, projectId]);

  const addImages = useCallback((files: File[]) => {
    files.filter((f) => f.type.startsWith('image/')).forEach((file) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        if (!dataUrl) return;

        const idx = Date.now() + Math.random();
        const entry: UploadedImage = { preview: dataUrl, uploading: true };

        setImages((prev) => [...prev, entry]);

        try {
          const serverUrl = await uploadImage(dataUrl, file.type);
          setImages((prev) =>
            prev.map((img) =>
              img.preview === dataUrl ? { ...img, url: serverUrl, uploading: false } : img
            )
          );
        } catch (err: any) {
          setImages((prev) =>
            prev.map((img) =>
              img.preview === dataUrl ? { ...img, uploading: false, error: err.message } : img
            )
          );
        }
      };
      reader.readAsDataURL(file);
    });
  }, [uploadImage]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addImages(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = Array.from(items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[];
    if (imageFiles.length === 0) return;
    e.preventDefault();
    addImages(imageFiles);
  };

  const removeImage = (preview: string) => {
    setImages((prev) => prev.filter((img) => img.preview !== preview));
  };

  const handleSend = () => {
    if (!message.trim() && images.length === 0) return;
    // 只发送已成功上传的图片 URL
    const readyUrls = images
      .filter((img) => img.url && !img.error)
      .map((img) => img.url as string);
    onSend(message, readyUrls.length > 0 ? readyUrls : undefined);
    setMessage('');
    setImages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const anyUploading = images.some((img) => img.uploading);

  return (
    <div className="border-t border-gray-200 p-4 bg-white">
      {/* 图片预览区 */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {images.map((img) => (
            <div key={img.preview} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.preview}
                alt="附件"
                className={`h-16 w-16 object-cover rounded-lg border ${
                  img.error ? 'border-red-400' : 'border-gray-200'
                }`}
              />
              {/* 上传中蒙层 */}
              {img.uploading && (
                <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                </div>
              )}
              {/* 上传失败标记 */}
              {img.error && (
                <div className="absolute inset-0 bg-red-500/40 rounded-lg flex items-center justify-center">
                  <span className="text-white text-xs">失败</span>
                </div>
              )}
              {/* 删除按钮 */}
              <button
                onClick={() => removeImage(img.preview)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-end">
        {/* 图片上传按钮 */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="p-2 rounded-lg text-gray-500 hover:text-blue-500 hover:bg-blue-50 disabled:opacity-40 transition-colors flex-shrink-0"
          title="上传图片"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="描述你想要创建的应用，或粘贴截图..."
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 placeholder:text-gray-400"
          rows={3}
          disabled={disabled}
        />

        <Button
          onClick={handleSend}
          disabled={disabled || anyUploading || (!message.trim() && images.length === 0)}
          className="self-end flex-shrink-0"
          title={anyUploading ? '图片上传中，请稍候...' : ''}
        >
          {disabled ? '生成中...' : anyUploading ? '上传中...' : '发送'}
        </Button>
      </div>

      <p className="text-xs text-gray-500 mt-2">
        提示：可上传截图或直接粘贴图片，详细描述你的需求
      </p>
    </div>
  );
}
