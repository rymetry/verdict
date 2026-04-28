import {
  RunCancelledPayloadSchema,
  RunCompletedPayloadSchema,
  RunErrorPayloadSchema,
  RunStdStreamPayloadSchema,
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

function assertValidPayload(input: Omit<WorkbenchEvent, "sequence" | "timestamp">): void {
  const result =
    input.type === "run.stdout" || input.type === "run.stderr"
      ? RunStdStreamPayloadSchema.safeParse(input.payload)
      : input.type === "run.completed"
        ? RunCompletedPayloadSchema.safeParse(input.payload)
        : input.type === "run.cancelled"
          ? RunCancelledPayloadSchema.safeParse(input.payload)
          : input.type === "run.error"
            ? RunErrorPayloadSchema.safeParse(input.payload)
            : null;
  if (result && !result.success) {
    throw new Error(`Invalid ${input.type} payload: ${result.error.issues.map((i) => i.message).join("; ")}`);
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
