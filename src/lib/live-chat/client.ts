export type LiveChatWireEvent = {
  type: "snapshot" | "message" | "status" | "queue";
  session?: import("./store").LiveChatSession;
  message?: import("./store").LiveChatMessage;
  sessions?: import("./store").LiveChatSessionSummary[];
};

export class LiveChatHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LiveChatHttpError";
  }
}

export async function consumeSse(
  response: Response,
  onEvent: (event: LiveChatWireEvent) => void,
) {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new LiveChatHttpError(
      payload?.error ?? "Koneksi live chat gagal.",
      response.status,
    );
  }
  if (!response.body)
    throw new Error("Browser tidak mendukung koneksi live chat.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          onEvent(JSON.parse(data) as LiveChatWireEvent);
        } catch (error) {
          if (error instanceof SyntaxError)
            throw new Error("Data live chat tidak valid.");
          throw error;
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
    if (done) return;
  }
}

export async function followSse(
  connect: (signal: AbortSignal) => Promise<Response>,
  onEvent: (event: LiveChatWireEvent) => void,
  onReconnect: () => void,
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    try {
      await consumeSse(await connect(signal), onEvent);
    } catch (error) {
      if (signal.aborted) return;
      if (
        error instanceof LiveChatHttpError &&
        error.status >= 400 &&
        error.status < 500
      )
        throw error;
    }

    if (signal.aborted) return;
    onReconnect();
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timeout = setTimeout(finish, 1000);
      signal.addEventListener("abort", finish, { once: true });
    });
  }
}
