/**
 * WebSocket Manager - 实时同步文件更新到前端
 * 重新导出共享版本以确保单例
 */

export {
  WebSocketManager,
  type FileUpdateEvent,
  type WorkflowProgressEvent,
} from './websocket-manager-shared';
