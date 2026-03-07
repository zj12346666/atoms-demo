'use client';

interface MessageItemProps {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  timestamp?: Date;
}

export function MessageItem({ role, content, images, timestamp }: MessageItemProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-800'
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs opacity-75">
            {isUser ? '你' : 'AI 助手'}
          </span>
          {timestamp && (
            <span className="text-xs opacity-50">
              {timestamp.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
        {images && images.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {images.map((src, idx) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={idx}
                src={src}
                alt={`图片 ${idx + 1}`}
                className="max-h-48 max-w-full rounded-lg object-contain border border-white/20"
              />
            ))}
          </div>
        )}
        {content && <div className="text-sm whitespace-pre-wrap mt-1">{content}</div>}
      </div>
    </div>
  );
}
