export function createSseResponse(
  request: Request,
  initialEvent: unknown,
  subscribe: (listener: (event: unknown) => void) => () => void,
  isTerminal: (event: unknown) => boolean = () => false,
) {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe = () => {};
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  let abortCleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          close(false);
          return;
        }
        if (isTerminal(event)) close(true);
      };
      unsubscribe = subscribe(send);
      send(initialEvent);
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          close(false);
        }
      }, 15000);

      const onAbort = () => close(true);
      request.signal.addEventListener("abort", onAbort, { once: true });
      abortCleanup = () => request.signal.removeEventListener("abort", onAbort);
      if (request.signal.aborted) onAbort();
    },
    cancel() {
      close(false);
    },
  });

  function close(closeController: boolean) {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe();
    abortCleanup();
    if (closeController) {
      try {
        controllerRef?.close();
      } catch {
        // The client may already have cancelled the stream.
      }
    }
  }

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
