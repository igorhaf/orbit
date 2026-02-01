/**
 * WebSocket Client Library
 * Handles real-time communication with backend for task execution updates
 */

export type WebSocketEventType =
  | 'batch_started'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'validation_failed'
  | 'batch_progress'
  | 'batch_completed';

export interface WebSocketMessage {
  event: WebSocketEventType;
  timestamp: string;
  data: any;
}

export type WebSocketEventHandler = (message: WebSocketMessage) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private projectId: string;
  private handlers: Map<WebSocketEventType | '*', Set<WebSocketEventHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isManualClose = false;

  // PROMPT #134 - Connection status callbacks (replaces polling)
  private onConnectCallback: (() => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;

  constructor(projectId: string, baseUrl?: string) {
    this.projectId = projectId;

    // Default to localhost if not provided
    const wsBaseUrl = baseUrl || 'ws://localhost:8000';
    this.url = `${wsBaseUrl}/api/v1/ws/projects/${projectId}`;
  }

  /**
   * Set callback for connection established
   * PROMPT #134 - Replaces polling for connection status
   */
  onConnect(callback: () => void): void {
    this.onConnectCallback = callback;
  }

  /**
   * Set callback for connection closed
   * PROMPT #134 - Replaces polling for connection status
   */
  onDisconnect(callback: () => void): void {
    this.onDisconnectCallback = callback;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected');
      return;
    }

    console.log(`[WebSocket] Connecting to ${this.url}...`);
    this.isManualClose = false;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected successfully');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;

        // Send ping to keep connection alive
        this.startPingInterval();

        // PROMPT #134 - Call connect callback
        this.onConnectCallback?.();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
      };

      this.ws.onclose = () => {
        console.log('[WebSocket] Connection closed');
        this.stopPingInterval();

        // PROMPT #134 - Call disconnect callback
        this.onDisconnectCallback?.();

        // Auto-reconnect if not manually closed
        if (!this.isManualClose) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      console.error('[WebSocket] Failed to create connection:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    console.log('[WebSocket] Disconnecting...');
    this.isManualClose = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopPingInterval();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Subscribe to specific event type
   */
  on(event: WebSocketEventType | '*', handler: WebSocketEventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /**
   * Unsubscribe from specific event type
   */
  off(event: WebSocketEventType | '*', handler: WebSocketEventHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  /**
   * Send message to server
   */
  send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[WebSocket] Cannot send message, not connected');
    }
  }

  /**
   * Get current connection status
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Private methods

  private handleMessage(message: WebSocketMessage): void {
    // Call event-specific handlers
    const eventHandlers = this.handlers.get(message.event);
    if (eventHandlers) {
      eventHandlers.forEach(handler => handler(message));
    }

    // Call wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach(handler => handler(message));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts; // Exponential backoff

    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private pingInterval: NodeJS.Timeout | null = null;

  private startPingInterval(): void {
    // Send ping every 30 seconds to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ command: 'ping' });
      }
    }, 30000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

/**
 * Global WebSocket client instances (singleton per project)
 */
const clients: Map<string, WebSocketClient> = new Map();

/**
 * Get or create WebSocket client for a project
 */
export function getWebSocketClient(projectId: string, baseUrl?: string): WebSocketClient {
  if (!clients.has(projectId)) {
    clients.set(projectId, new WebSocketClient(projectId, baseUrl));
  }
  return clients.get(projectId)!;
}

/**
 * Remove WebSocket client for a project
 */
export function removeWebSocketClient(projectId: string): void {
  const client = clients.get(projectId);
  if (client) {
    client.disconnect();
    clients.delete(projectId);
  }
}
