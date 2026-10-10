import type { WebinarEvent } from "./types.js";

/** Bounded stream: slow consumers get an error rather than missing changes silently. */
export async function* webinarEvents(
  subscribe: (listener: (event: WebinarEvent) => void) => () => void,
  opts: { signal?: AbortSignal; bufferSize?: number } = {},
): AsyncGenerator<WebinarEvent> {
  const limit = opts.bufferSize ?? 512;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid webinar event buffer size");
  const queue: WebinarEvent[] = [];
  let wake: (() => void) | undefined;
  let done = opts.signal?.aborted ?? false;
  let overflow = false;
  const unsubscribe = subscribe((event) => {
    if (queue.length >= limit) { overflow = true; done = true; }
    else queue.push(event);
    if (event.type === "disconnected") done = true;
    wake?.();
  });
  const abort = () => { done = true; wake?.(); };
  opts.signal?.addEventListener("abort", abort, { once: true });
  try {
    while (queue.length || !done) {
      if (overflow) throw new Error("Webinar event buffer overflow; refresh the snapshot");
      const event = queue.shift();
      if (event) yield event;
      else await new Promise<void>((resolve) => { wake = resolve; });
    }
  } finally {
    unsubscribe();
    opts.signal?.removeEventListener("abort", abort);
  }
}
