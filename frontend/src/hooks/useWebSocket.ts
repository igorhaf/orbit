/**
 * useWebSocket React Hook
 * Provides easy-to-use interface for WebSocket communication in React components
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  WebSocketClient,
  WebSocketMessage,
  WebSocketEventType,
  WebSocketEventHandler,
  getWebSocketClient,
  removeWebSocketClient,
} from '@/lib/websocket';

interface UseWebSocketOptions {
  projectId: string;
  baseUrl?: string;
  autoConnect?: boolean;
}

interface UseWebSocketReturn {
  messages: WebSocketMessage[];
  lastMessage: WebSocketMessage | null;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  subscribe: (event: WebSocketEventType | '*', handler: WebSocketEventHandler) => void;
  unsubscribe: (event: WebSocketEventType | '*', handler: WebSocketEventHandler) => void;
  clearMessages: () => void;
}

/**
 * Hook to manage WebSocket connection and messages for a project
 *
 * @example
 * ```tsx
 * const { messages, isConnected, subscribe } = useWebSocket({
 *   projectId: '123',
 *   autoConnect: true
 * });
 *
 * useEffect(() => {
 *   const handler = (message) => {
 *     console.log('Task started:', message.data);
 *   };
 *   subscribe('task_started', handler);
 *   return () => unsubscribe('task_started', handler);
 * }, []);
 * ```
 */
export function useWebSocket({
  projectId,
  baseUrl,
  autoConnect = true,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const clientRef = useRef<WebSocketClient | null>(null);
  const checkConnectionInterval = useRef<NodeJS.Timeout | null>(null);

  // Initialize WebSocket client
  useEffect(() => {
    clientRef.current = getWebSocketClient(projectId, baseUrl);

    if (autoConnect) {
      clientRef.current.connect();
    }

    // Cleanup on unmount
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
      if (checkConnectionInterval.current) {
        clearInterval(checkConnectionInterval.current);
      }
    };
  }, [projectId, baseUrl, autoConnect]);

  // Monitor connection status
  useEffect(() => {
    checkConnectionInterval.current = setInterval(() => {
      if (clientRef.current) {
        setIsConnected(clientRef.current.isConnected());
      }
    }, 1000);

    return () => {
      if (checkConnectionInterval.current) {
        clearInterval(checkConnectionInterval.current);
      }
    };
  }, []);

  // Subscribe to all messages to update state
  useEffect(() => {
    if (!clientRef.current) return;

    const handleMessage: WebSocketEventHandler = (message) => {
      setLastMessage(message);
      setMessages((prev) => [...prev, message]);
    };

    clientRef.current.on('*', handleMessage);

    return () => {
      if (clientRef.current) {
        clientRef.current.off('*', handleMessage);
      }
    };
  }, []);

  const connect = useCallback(() => {
    clientRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  const subscribe = useCallback(
    (event: WebSocketEventType | '*', handler: WebSocketEventHandler) => {
      clientRef.current?.on(event, handler);
    },
    []
  );

  const unsubscribe = useCallback(
    (event: WebSocketEventType | '*', handler: WebSocketEventHandler) => {
      clientRef.current?.off(event, handler);
    },
    []
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setLastMessage(null);
  }, []);

  return {
    messages,
    lastMessage,
    isConnected,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    clearMessages,
  };
}

/**
 * Hook to subscribe to specific WebSocket event types
 *
 * @example
 * ```tsx
 * useWebSocketEvent('task_completed', (message) => {
 *   console.log('Task completed:', message.data);
 * }, { projectId: '123' });
 * ```
 */
export function useWebSocketEvent(
  event: WebSocketEventType,
  handler: WebSocketEventHandler,
  options: UseWebSocketOptions
): void {
  const { subscribe, unsubscribe } = useWebSocket(options);

  useEffect(() => {
    subscribe(event, handler);
    return () => unsubscribe(event, handler);
  }, [event, handler, subscribe, unsubscribe]);
}
