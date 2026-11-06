import { EventEmitter } from "node:events";
import type { BusMessage } from "@/lib/domain/types";

/**
 * In-process pub/sub between the MQTT bridge and SSE handlers.
 * Lives on globalThis because instrumentation and route handlers are separate module graphs in dev.
 */
class Bus extends EventEmitter {
  publish(m: BusMessage): void {
    this.emit("message", m);
  }
  subscribe(fn: (m: BusMessage) => void): () => void {
    this.on("message", fn);
    return () => this.off("message", fn);
  }
}

const g = globalThis as typeof globalThis & { __axiometerBus?: Bus };

export function getBus(): Bus {
  if (!g.__axiometerBus) {
    g.__axiometerBus = new Bus();
    g.__axiometerBus.setMaxListeners(0); // one listener per open browser tab
  }
  return g.__axiometerBus;
}
