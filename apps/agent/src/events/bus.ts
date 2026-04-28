import {
  RunQueuedPayloadSchema,
  RunStartedPayloadSchema,
  RunStdStreamPayloadSchema,
  RunTerminalPayloadSchema,
  SnapshotPayloadSchema,
  terminalStatusMatchesEvent,
  type WorkbenchEvent,
  type WorkbenchEventInput
} from "@pwqa/shared";

export type EventListener = (event: WorkbenchEvent) => void;

const RUN_HISTORY_LIMIT = 2_000;

export interface EventBus {
  publish(event: WorkbenchEventInput): WorkbenchEvent;
  /** Subscribe to all events. Returns an unsubscribe function. */
  subscribe(listener: EventListener): () => void;
  /** Snapshot of historical events for a run, used on WS reconnect. */
  snapshot(runId: string): ReadonlyArray<WorkbenchEvent>;
}

export interface CreateEventBusOptions {
  onListenerError?: (error: unknown) => void;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled event type: ${String(value)}`);
}

class PayloadValidationError extends Error {
  readonly code = "PAYLOAD_VALIDATION_FAILED" as const;

  constructor(message: string) {
    super(message);
    this.name = "PayloadValidationError";
  }
}

/**
 * Producer-side contract check for WS payloads. Envelope validation alone keeps
 * `payload` unknown, so publish validates the event-specific body before it can
 * enter history or reach subscribers.
 */
function assertValidPayload(input: WorkbenchEventInput): void {
  switch (input.type) {
    case "run.queued": {
      const result = RunQueuedPayloadSchema.safeParse(input.payload);
      if (!result.success) throwPayloadError(input.type, result.error.issues);
      return;
    }
    case "run.started": {
      const result = RunStartedPayloadSchema.safeParse(input.payload);
      if (!result.success) throwPayloadError(input.type, result.error.issues);
      return;
    }
    case "run.stdout":
    case "run.stderr": {
      const result = RunStdStreamPayloadSchema.safeParse(input.payload);
      if (!result.success) throwPayloadError(input.type, result.error.issues);
      return;
    }
    case "run.completed":
    case "run.cancelled":
    case "run.error": {
      const parsed = RunTerminalPayloadSchema.safeParse(input.payload);
      if (!parsed.success) throwPayloadError(input.type, parsed.error.issues);
      if (!terminalStatusMatchesEvent(input.type, parsed.data.status)) {
        throw new PayloadValidationError(
          `Invalid ${input.type} payload: status ${parsed.data.status} does not match event type`
        );
      }
      return;
    }
    case "snapshot": {
      const result = SnapshotPayloadSchema.safeParse(input.payload);
      if (!result.success) throwPayloadError(input.type, result.error.issues);
      return;
    }
    default:
      assertNever(input);
  }
}

function throwPayloadError(
  type: WorkbenchEvent["type"],
  issues: Array<{ message: string }>
): never {
  throw new PayloadValidationError(`Invalid ${type} payload: ${issues.map((i) => i.message).join("; ")}`);
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
