import "server-only";

/** Server configuration. Read lazily so `next build` works without secrets present. */
export interface ServerEnv {
  mqttUrl: string | null;
  mqttUsername: string | undefined;
  mqttPassword: string | undefined;
  topicRoot: string;
  retentionDays: number;
  databasePath: string;
}

export function serverEnv(): ServerEnv {
  const retention = Number(process.env.RETENTION_DAYS ?? 30);
  return {
    mqttUrl: process.env.MQTT_URL?.trim() || null,
    mqttUsername: process.env.MQTT_USERNAME || undefined,
    mqttPassword: process.env.MQTT_PASSWORD || undefined,
    topicRoot: (process.env.MQTT_TOPIC_ROOT || "devices").replace(/^\/+|\/+$/g, ""),
    retentionDays: Number.isFinite(retention) && retention > 0 ? retention : 30,
    databasePath: process.env.DATABASE_PATH || "./data/axiometer.db",
  };
}

/** Strip credentials from a broker URL before showing it anywhere. */
export function redactUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return "(invalid MQTT_URL)";
  }
}
