import {
  WorkbenchEventSchema,
  type WorkbenchEvent
} from "@pwqa/shared";

export type EventListener = (event: WorkbenchEvent) => void;

export interface EventStream {
  subscribe(listener: EventListener): () => void;
  close(): void;
}

const RECONNECT_DELAY_MS = 1500;

export function connectWorkbenchEvents(): EventStream {
  const listeners = new Set<EventListener>();
  let socket: WebSocket | undefined;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function url(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }

  function connect(): void {
    if (closed) return;
    socket = new WebSocket(url());
    socket.addEventListener("message", (raw) => {
      const data: unknown = (() => {
        try {
          return JSON.parse(raw.data as string);
        } catch {
          return undefined;
        }
      })();
      if (!data) return;
      const parsed = WorkbenchEventSchema.safeParse(data);
      if (!parsed.success) return;
      for (const listener of listeners) listener(parsed.data);
    });
    socket.addEventListener("close", () => {
      if (closed) return;
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });
    socket.addEventListener("error", () => {
      socket?.close();
    });
  }

  connect();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    }
  };
}
