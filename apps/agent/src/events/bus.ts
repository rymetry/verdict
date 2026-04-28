import {
  RunQueuedPayloadSchema,
  RunStartedPayloadSchema,
  RunStdStreamPayloadSchema,
  RunTerminalPayloadSchema,
  SnapshotPayloadSchema,
  type WorkbenchEvent
} from "@pwqa/shared";

export type EventListener = (event: WorkbenchEvent) => void;

const RUN_HISTORY_LIMIT = 2_000;

export interface EventBus {
  publish(event: Omit<WorkbenchEvent, "sequence" | "timestamp">): WorkbenchEvent;
  /** Subscribe to all events. Returns an unsubscribe function. */
  subscribe(listener: EventListener): () => void;
  /** Snapshot of historical events for a run, used on WS reconnect. */
  snapshot(runId: string): ReadonlyArray<WorkbenchEvent>;
}

export interface CreateEventBusOptions {
  onListenerError?: (error: unknown) => void;
}

const TERMINAL_STATUS_BY_EVENT = {
  "run.completed": new Set(["passed", "failed"]),
  "run.cancelled": new Set(["cancelled"]),
  "run.error": new Set(["error"])
} as const;

/**
 * Producer-side contract check for WS payloads. Envelope validation alone keeps
 * `payload` unknown, so publish validates the event-specific body before it can
 * enter history or reach subscribers.
 */
function assertValidPayload(input: Omit<WorkbenchEvent, "sequence" | "timestamp">): void {
  const result = (() => {
    if (input.type === "run.queued") return RunQueuedPayloadSchema.safeParse(input.payload);
    if (input.type === "run.started") return RunStartedPayloadSchema.safeParse(input.payload);
    if (input.type === "run.stdout" || input.type === "run.stderr") {
      return RunStdStreamPayloadSchema.safeParse(input.payload);
    }
    if (
      input.type === "run.completed" ||
      input.type === "run.cancelled" ||
      input.type === "run.error"
    ) {
      const parsed = RunTerminalPayloadSchema.safeParse(input.payload);
      if (!parsed.success) return parsed;
      if (!TERMINAL_STATUS_BY_EVENT[input.type].has(parsed.data.status as never)) {
        throw new Error(`Invalid ${input.type} payload: status ${parsed.data.status} does not match event type`);
      }
      return parsed;
    }
    if (input.type === "snapshot") return SnapshotPayloadSchema.safeParse(input.payload);
    return null;
  })();
  if (result && !result.success) {
    throw new Error(
      `Invalid ${input.type} payload: ${result.error.issues.map((i) => i.message).join("; ")}`
    );
  }
}

export function createEventBus(options: CreateEventBusOptions = {}): EventBus {
  const listeners = new Set<EventListener>();
  let nextSequence = 0;
  /** Per-run circular buffer for WS reconnect snapshots. */
  const history = new Map<string, WorkbenchEvent[]>();

  return {
    publish(input) {
      assertValidPayload(input);
      const sequence = ++nextSequence;
      const event: WorkbenchEvent = {
        ...input,
        sequence,
        timestamp: new Date().toISOString()
      };
      if (event.runId) {
        const list = history.get(event.runId) ?? [];
        list.push(event);
        if (list.length > RUN_HISTORY_LIMIT) {
          list.splice(0, list.length - RUN_HISTORY_LIMIT);
        }
        history.set(event.runId, list);
      }
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          options.onListenerError?.(error);
        }
      }
      return event;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot(runId: string) {
      return history.get(runId) ?? [];
    }
  };
}
