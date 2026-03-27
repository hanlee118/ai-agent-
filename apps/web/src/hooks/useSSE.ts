import { useEffect, useRef, useState } from 'react';

export interface UseSSEOptions {
  enabled?: boolean;
  withCredentials?: boolean;
  events?: string[];
  maxRetries?: number;
  retryIntervalMs?: number;
  onOpen?: () => void;
  onEvent?: (event: MessageEvent) => void;
  onError?: (error: Event) => void;
}

export function useSSE(url: string, options: UseSSEOptions = {}) {
  const {
    enabled = true,
    withCredentials = true,
    events = [],
    maxRetries = 5,
    retryIntervalMs = 3000,
    onOpen,
    onEvent,
    onError,
  } = options;

  const [connected, setConnected] = useState(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }

    let cancelled = false;

    const cleanupTimers = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const teardown = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    const connect = () => {
      if (cancelled) {
        return;
      }

      teardown();

      const source = new EventSource(url, { withCredentials });
      eventSourceRef.current = source;

      const handleOpen = () => {
        retryCountRef.current = 0;
        setConnected(true);
        onOpen?.();
      };

      const handleEvent = (event: MessageEvent) => {
        onEvent?.(event);
      };

      const handleError = (event: Event) => {
        setConnected(false);
        onError?.(event);

        teardown();

        if (retryCountRef.current >= maxRetries) {
          return;
        }

        retryCountRef.current += 1;
        cleanupTimers();
        retryTimerRef.current = setTimeout(connect, retryIntervalMs);
      };

      source.onopen = handleOpen;
      source.onmessage = handleEvent;
      source.onerror = handleError;

      events.forEach((name) => {
        source.addEventListener(name, handleEvent as EventListener);
      });
    };

    connect();

    return () => {
      cancelled = true;
      cleanupTimers();
      teardown();
      setConnected(false);
    };
  }, [enabled, events, maxRetries, onError, onEvent, onOpen, retryIntervalMs, url, withCredentials]);

  return { connected };
}
