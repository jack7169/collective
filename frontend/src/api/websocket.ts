import { useState, useEffect, useRef, useCallback } from "react";
import type { ScanProgress } from "./types";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);

export function useScanProgress(scanId: string | undefined) {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const lastStatusRef = useRef<string | null>(null);

  const connect = useCallback(() => {
    if (!scanId) return;

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/scans/${scanId}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ScanProgress;
          setProgress(data);

          // If status changed from terminal to active, reset reconnect counter
          if (lastStatusRef.current && TERMINAL_STATUSES.has(lastStatusRef.current) && !TERMINAL_STATUSES.has(data.status)) {
            reconnectAttemptsRef.current = 0;
          }
          lastStatusRef.current = data.status;
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;

        // Always reconnect — the scan might be resumed
        // Use shorter interval for recently-active scans
        const delay = Math.min(
          1000 * Math.pow(1.5, Math.min(reconnectAttemptsRef.current, 10)),
          10000 // Cap at 10s instead of 30s
        );
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Connection failed, will retry via onclose
    }
  }, [scanId]);

  // Force reconnect function exposed for manual trigger
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { progress, isConnected, reconnect };
}
