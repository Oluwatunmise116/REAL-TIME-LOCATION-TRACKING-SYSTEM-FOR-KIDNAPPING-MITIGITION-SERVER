import { buildSnapshot, requireSession } from "@/lib/server/api";
import { getBus } from "@/lib/server/bus";
import type { StreamMessage } from "@/lib/domain/types";

const PING_MS = 15_000;

export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (m: StreamMessage) => write(`data: ${JSON.stringify(m)}\n\n`);

      write("retry: 3000\n\n");
      // Node is single-threaded: subscribing right after building the snapshot cannot miss a bus message.
      send(buildSnapshot());
      const unsubscribe = getBus().subscribe(send);
      const ping = setInterval(() => write(`: ping ${Date.now()}\n\n`), PING_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
