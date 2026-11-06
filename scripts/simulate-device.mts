/**
 * Axiometer device simulator. Publishes exactly the firmware contract:
 *
 *   devices/<id>/status     "online" (retained, QoS 1); Last Will "offline"
 *   devices/<id>/heartbeat  {"seq","up"} every 2 s, QoS 0
 *   devices/<id>/telemetry  {"ts","lat","lon"} every 10 s, QoS 1 (null for the first 30 s: cold start)
 *   devices/<id>/motion     state transitions, QoS 1
 *   devices/<id>/sos        button activations, QoS 1
 *
 * Usage:
 *   npm run simulate                                   # broker from .env (MQTT_URL/USERNAME/PASSWORD)
 *   npm run simulate -- --url mqtt://localhost:1883    # local broker
 *   npm run simulate -- --id sim-002 --motion --sos --reboot --drop --null-ts
 *
 * Flags:
 *   --id <id>          device id (default sim-001)
 *   --count <n>        simulate n devices (sim-001 … sim-00n, staggered routes)
 *   --motion           CANDIDATE → SUSPICIOUS (SUSPECTED_DISTRESS) → NORMAL         (at --motion-at, default 40 s)
 *   --sos              SOS SUSPICIOUS presses, then DANGER at 10, plus one duplicate (at --sos-at, default 50 s)
 *   --reboot           reset seq/up and lose the GPS fix                          (at --reboot-at, default 90 s)
 *   --drop             stop heartbeats for 15 s → "Signal lost"                   (at --drop-at, default 25 s)
 *   --null-ts          send "ts": null (device clock not synced)
 *   --no-fix           never acquire a GPS fix
 *   --fix-after <s>    seconds until the first fix (default 30)
 *   --duration <s>     exit after this many seconds (publishes retained "offline")
 *   --kill             on exit, drop the socket without a clean disconnect so the broker fires the Last Will
 */
import nextEnv from "@next/env";
import mqtt, { type MqttClient } from "mqtt";

// ---------- args / env ----------

// Same parser as Next.js, so quoting and $ escapes in .env mean the same thing for scripts and the app.
nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const num = (name: string, fallback: number) => Number(opt(name, String(fallback)));

const URL_ = opt("url", process.env.MQTT_URL);
if (!URL_) {
  console.error("No broker URL. Pass --url mqtt://localhost:1883 or set MQTT_URL in .env");
  process.exit(1);
}
// A device credential is separate from the dashboard's subscribe-only one.
const USERNAME = opt("username", process.env.SIM_MQTT_USERNAME ?? process.env.MQTT_USERNAME);
const PASSWORD = opt("password", process.env.SIM_MQTT_PASSWORD ?? process.env.MQTT_PASSWORD);
const ROOT = (process.env.MQTT_TOPIC_ROOT || "devices").replace(/^\/+|\/+$/g, "");
const COUNT = Math.max(1, num("count", 1));
const BASE_ID = opt("id", "sim-001")!;

const scenario = {
  motion: flag("motion"),
  motionAt: num("motion-at", 40),
  sos: flag("sos"),
  sosAt: num("sos-at", 50),
  reboot: flag("reboot"),
  rebootAt: num("reboot-at", 90),
  drop: flag("drop"),
  dropAt: num("drop-at", 25),
  nullTs: flag("null-ts"),
  noFix: flag("no-fix"),
  fixAfter: num("fix-after", 30),
  duration: num("duration", 0),
  kill: flag("kill"),
};

// ---------- route: Yaba → Ikeja along Ikorodu Rd / Obafemi Awolowo Way ----------

const ROUTE: [number, number][] = [
  [6.5095, 3.3711], // Yaba
  [6.517, 3.3752],
  [6.5262, 3.3718], // Fadeyi
  [6.5355, 3.3672],
  [6.5442, 3.3634], // Onipanu
  [6.5528, 3.3601], // Palmgrove
  [6.564, 3.3652],
  [6.5717, 3.3672], // Maryland
  [6.5822, 3.359],
  [6.5915, 3.3529],
  [6.6018, 3.3515], // Ikeja
];

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
function distance(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

class Walker {
  private leg = 0;
  private t = 0; // 0..1 along the current leg
  private dir = 1;
  constructor(offsetMeters: number) {
    this.advance(offsetMeters);
  }
  advance(meters: number) {
    while (meters > 0) {
      const a = ROUTE[this.leg];
      const b = ROUTE[this.leg + this.dir];
      const len = distance(a, b);
      const remaining = (1 - this.t) * len;
      if (meters < remaining) {
        this.t += meters / len;
        return;
      }
      meters -= remaining;
      this.leg += this.dir;
      this.t = 0;
      if (this.leg + this.dir < 0 || this.leg + this.dir >= ROUTE.length) this.dir = -this.dir; // turn around
    }
  }
  position(): [number, number] {
    const a = ROUTE[this.leg];
    const b = ROUTE[this.leg + this.dir];
    const jitter = () => (Math.random() - 0.5) * 0.00002; // ~±1 m
    return [a[0] + (b[0] - a[0]) * this.t + jitter(), a[1] + (b[1] - a[1]) * this.t + jitter()];
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ---------- one simulated device ----------

class Device {
  private client: MqttClient;
  private seq = 0;
  private bootAt = Date.now();
  private startedAt = Date.now();
  private fixAt: number | null;
  private walker: Walker;
  private sosSeq = 0;
  private sosWindow: number[] = [];
  private heartbeatsPausedUntil = 0;
  private timers: NodeJS.Timeout[] = [];
  private lastFix: { lat: number; lon: number; at: number } | null = null;
  private motionState = "INITIALIZING";

  constructor(
    private readonly id: string,
    index: number,
  ) {
    this.walker = new Walker(index * 900);
    this.fixAt = scenario.noFix ? null : this.startedAt + scenario.fixAfter * 1000;
    const statusTopic = this.topic("status");
    this.client = mqtt.connect(URL_!, {
      clientId: `axiometer-sim-${id}-${Math.random().toString(16).slice(2, 8)}`,
      username: USERNAME,
      password: PASSWORD,
      clean: true,
      keepalive: 20,
      reconnectPeriod: 3_000,
      will: { topic: statusTopic, payload: Buffer.from("offline"), qos: 1, retain: true },
    });
    this.client.on("connect", () => {
      this.log(`connected to ${URL_!.replace(/\/\/[^@]*@/, "//")}`);
      this.client.publish(statusTopic, "online", { qos: 1, retain: true });
    });
    this.client.on("error", (e) => this.log(`error: ${e.message}`));
    this.client.on("reconnect", () => this.log("reconnecting…"));
  }

  private topic(ch: string) {
    return `${ROOT}/${this.id}/${ch}`;
  }
  private log(msg: string) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${this.id} ${msg}`);
  }
  private ts(): string | null {
    return scenario.nullTs ? null : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  private pub(ch: string, body: object, qos: 0 | 1) {
    const payload = JSON.stringify(body);
    this.client.publish(this.topic(ch), payload, { qos, retain: false });
    if (ch !== "heartbeat") this.log(`→ ${ch} ${payload}`);
  }
  private every(ms: number, fn: () => void) {
    this.timers.push(setInterval(fn, ms));
  }
  private after(sec: number, fn: () => void) {
    this.timers.push(setTimeout(fn, sec * 1000));
  }
  private hasFix() {
    return this.fixAt !== null && Date.now() >= this.fixAt;
  }
  /** Position + age as alerts carry them (age -1 = no position). */
  private alertPosition() {
    if (!this.lastFix) return { lat: null, lon: null, age: -1 };
    return { lat: this.lastFix.lat, lon: this.lastFix.lon, age: Math.round((Date.now() - this.lastFix.at) / 1000) };
  }

  start() {
    // Movement at 5–15 m/s, sampled every second; the GPS "accepts" a fix every second once available.
    let speed = 10;
    this.every(1_000, () => {
      speed = Math.min(15, Math.max(5, speed + (Math.random() - 0.5) * 2));
      this.walker.advance(speed);
      if (this.hasFix()) {
        const [lat, lon] = this.walker.position();
        this.lastFix = { lat: round6(lat), lon: round6(lon), at: Date.now() };
      }
    });

    this.every(2_000, () => {
      if (Date.now() < this.heartbeatsPausedUntil || !this.client.connected) return;
      this.seq++;
      this.pub("heartbeat", { seq: this.seq, up: Math.floor((Date.now() - this.bootAt) / 1000) }, 0);
    });

    this.every(10_000, () => {
      const p = this.lastFix;
      this.pub("telemetry", { ts: this.ts(), lat: p?.lat ?? null, lon: p?.lon ?? null }, 1);
    });

    this.after(3, () => this.motion("CALIBRATING"));
    this.after(8, () => this.motion("NORMAL"));

    if (scenario.drop) {
      this.after(scenario.dropAt, () => {
        this.log("--drop: pausing heartbeats for 15 s");
        this.heartbeatsPausedUntil = Date.now() + 15_000;
      });
    }
    if (scenario.motion) {
      this.after(scenario.motionAt, () => this.motion("CANDIDATE"));
      this.after(scenario.motionAt + 1.2, () => this.motion("SUSPICIOUS", "SUSPECTED_DISTRESS"));
      this.after(scenario.motionAt + 30, () => this.motion("NORMAL"));
    }
    if (scenario.sos) this.after(scenario.sosAt, () => this.sosSequence());
    if (scenario.reboot) this.after(scenario.rebootAt, () => this.reboot());
  }

  private motion(state: string, indicator?: string) {
    const prev = this.motionState;
    this.motionState = state;
    this.pub("motion", { state, prev, ...(indicator ? { indicator } : {}), ts: this.ts(), ...this.alertPosition() }, 1);
  }

  private press(): object {
    const now = Date.now();
    this.sosWindow = this.sosWindow.filter((t) => now - t < 120_000);
    this.sosWindow.push(now);
    this.sosSeq++;
    const presses = this.sosWindow.length;
    return { level: presses >= 10 ? "DANGER" : "SUSPICIOUS", presses, seq: this.sosSeq, ts: this.ts(), ...this.alertPosition() };
  }

  private sosSequence() {
    this.log("--sos: first activation, then 9 more within 2 min");
    this.pub("sos", this.press(), 1);
    for (let i = 1; i < 10; i++) {
      this.after(i * 1.5, () => {
        const body = this.press();
        this.pub("sos", body, 1);
        if (i === 9) {
          // Firmware retry of the DANGER message: same seq and ts → must be deduplicated.
          this.after(1, () => {
            this.log("--sos: duplicate retry of DANGER");
            this.pub("sos", body, 1);
          });
        }
      });
    }
  }

  private reboot() {
    this.log("--reboot: resetting seq/up, GPS cold start");
    this.seq = 0;
    this.bootAt = Date.now();
    this.lastFix = null;
    this.motionState = "INITIALIZING";
    if (this.fixAt !== null) this.fixAt = Date.now() + scenario.fixAfter * 1000;
    this.client.publish(this.topic("status"), "online", { qos: 1, retain: true });
    this.after(3, () => this.motion("CALIBRATING"));
    this.after(8, () => this.motion("NORMAL"));
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    if (scenario.kill) {
      this.log("killing socket (broker will publish the Last Will)");
      this.client.stream.destroy();
      return;
    }
    await new Promise<void>((resolve) =>
      this.client.publish(this.topic("status"), "offline", { qos: 1, retain: true }, () => this.client.end(false, {}, () => resolve())),
    );
    this.log("published offline and disconnected");
  }
}

// ---------- main ----------

const ids =
  COUNT === 1
    ? [BASE_ID]
    : Array.from({ length: COUNT }, (_, i) => BASE_ID.replace(/\d+$/, (m) => String(Number(m) + i).padStart(m.length, "0")));
const devices = ids.map((id, i) => new Device(id, i));
for (const d of devices) d.start();
console.log(`Simulating ${ids.join(", ")} on ${URL_.replace(/\/\/[^@]*@/, "//")} (root "${ROOT}")`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await Promise.all(devices.map((d) => d.stop()));
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (scenario.duration > 0) setTimeout(shutdown, scenario.duration * 1000);
