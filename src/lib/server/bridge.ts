import "server-only";
import { randomBytes } from "node:crypto";
import mqtt, { type MqttClient } from "mqtt";
import type { BrokerHealth, BrokerState } from "@/lib/domain/types";
import { getBus } from "./bus";
import { getDb } from "./db/client";
import { purgeOlderThan } from "./db/repo";
import { Engine } from "./engine";
import { redactUrl, serverEnv } from "./env";

interface Bridge {
  engine: Engine;
  client: MqttClient | null;
  health: BrokerHealth;
  timers: NodeJS.Timeout[];
}

const g = globalThis as typeof globalThis & { __axiometerBridge?: Bridge };

const TICK_MS = 1_000;
const RETENTION_EVERY_MS = 60 * 60 * 1000;

function setHealth(b: Bridge, patch: Partial<BrokerHealth>): void {
  const prev = b.health;
  b.health = { ...prev, ...patch };
  if (prev.state !== b.health.state || prev.lastError !== b.health.lastError) {
    getBus().publish({ type: "broker.updated", broker: b.health });
  }
}

function runRetention(days: number): void {
  try {
    const cutoff = Date.now() - days * 86_400_000;
    const r = purgeOlderThan(getDb(), cutoff);
    if (r.positions || r.raw || r.heartbeats || r.events) console.info(`[retention] purged older than ${days}d`, r);
  } catch (err) {
    console.error("[retention] failed:", err);
  }
}

/** Start the MQTT bridge once per process. Safe to call from anywhere; later calls return the singleton. */
export function ensureBridge(): Bridge {
  if (g.__axiometerBridge) return g.__axiometerBridge;
  if (process.env.NEXT_PHASE === "phase-production-build") {
    // A route handler is being prerendered: it must read the request before touching the bridge.
    throw new Error("ensureBridge() called during `next build`; read the request first so the route stays dynamic");
  }

  const env = serverEnv();
  const bus = getBus();
  const engine = new Engine(getDb(), (m) => bus.publish(m), { topicRoot: env.topicRoot });
  const bridge: Bridge = {
    engine,
    client: null,
    health: { state: "connecting", url: redactUrl(env.mqttUrl), lastMessageAt: null, connectedAt: null, lastError: null },
    timers: [],
  };
  g.__axiometerBridge = bridge;

  bridge.timers.push(setInterval(() => engine.tick(Date.now()), TICK_MS));
  bridge.timers.push(setInterval(() => runRetention(env.retentionDays), RETENTION_EVERY_MS));
  setTimeout(() => runRetention(env.retentionDays), 5_000).unref();
  for (const t of bridge.timers) t.unref();

  if (!env.mqttUrl) {
    console.warn("[mqtt] MQTT_URL is not set; the bridge is idle. Set it in .env to receive device data.");
    setHealth(bridge, { state: "not_configured", lastError: "MQTT_URL is not set" });
    return bridge;
  }

  const clientId = `axiometer-dash-${randomBytes(4).toString("hex")}`;
  const topic = `${env.topicRoot}/+/#`;
  const client = mqtt.connect(env.mqttUrl, {
    clientId,
    username: env.mqttUsername,
    password: env.mqttPassword,
    clean: true,
    keepalive: 30,
    connectTimeout: 15_000,
    reconnectPeriod: 2_000,
    // mqtt.js retries at a fixed period; stretch it while the broker stays unreachable.
    reconnectOnConnackError: true,
    protocolVersion: 4,
  });
  bridge.client = client;
  let failures = 0;

  client.on("connect", () => {
    failures = 0;
    client.options.reconnectPeriod = 2_000;
    console.info(`[mqtt] connected to ${bridge.health.url} as ${clientId}`);
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.error(`[mqtt] subscribe ${topic} failed:`, err.message);
        setHealth(bridge, { state: "error", lastError: `subscribe failed: ${err.message}` });
        return;
      }
      console.info(`[mqtt] subscribed to ${topic}`);
      engine.onSubscribed(Date.now());
      setHealth(bridge, { state: "connected", connectedAt: Date.now(), lastError: null });
    });
  });

  client.on("message", (t, payload, packet) => {
    const now = Date.now();
    bridge.health.lastMessageAt = now;
    engine.handle(t, payload, now, packet.retain);
  });

  client.on("reconnect", () => {
    failures++;
    // Exponential backoff: 2 s, 4 s, 8 s … capped at 60 s.
    client.options.reconnectPeriod = Math.min(60_000, 2_000 * 2 ** Math.min(failures, 5));
    console.info(`[mqtt] reconnecting (attempt ${failures}, next in ${client.options.reconnectPeriod / 1000}s)`);
    setHealth(bridge, { state: "reconnecting" });
  });

  client.on("close", () => {
    engine.onDisconnected();
    if (bridge.health.state === "connected") {
      console.warn("[mqtt] disconnected");
      setHealth(bridge, { state: "reconnecting" });
    }
  });

  client.on("offline", () => {
    engine.onDisconnected();
    setHealth(bridge, { state: "offline" });
  });

  client.on("error", (err) => {
    console.error("[mqtt] error:", err.message);
    setHealth(bridge, { state: "error", lastError: err.message });
  });

  const shutdown = () => {
    try {
      engine.flush();
      client.end(true);
    } catch {
      /* exiting anyway */
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  return bridge;
}

export function brokerHealth(): BrokerHealth {
  return ensureBridge().health;
}

export function brokerState(): BrokerState {
  return ensureBridge().health.state;
}
