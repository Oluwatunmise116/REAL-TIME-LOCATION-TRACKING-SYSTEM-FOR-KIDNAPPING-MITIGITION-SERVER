import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/server/db/client";
import * as repo from "@/lib/server/db/repo";
import { Engine, WARMUP_MS } from "@/lib/server/engine";
import type { BusMessage, EventView } from "@/lib/domain/types";

const T0 = Date.parse("2026-10-30T02:00:00Z");
const ID = "sim-001";
const silent = { info: () => {}, warn: () => {}, error: () => {} };

function setup() {
  const { db, sqlite } = openDb(":memory:");
  const out: BusMessage[] = [];
  const engine = new Engine(db, (m) => out.push(m), { topicRoot: "devices", log: silent });
  const send = (channel: string, payload: string, retained = false) =>
    engine.handle(`devices/${ID}/${channel}`, payload, Date.now(), retained);
  const events = (type?: string) => repo.listEvents(db, { types: type ? [type as EventView["type"]] : undefined }).events;
  return { db, sqlite, engine, out, send, events };
}

/** Advance fake time in 1 s ticks, optionally sending a heartbeat every 2 s. */
function run(engine: Engine, ms: number, beat?: () => void) {
  for (let elapsed = 0; elapsed < ms; elapsed += 1_000) {
    vi.advanceTimersByTime(1_000);
    if (beat && (Date.now() / 1_000) % 2 === 0) beat();
    engine.tick(Date.now());
  }
}

describe("Engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("SOS retries are deduplicated on (deviceId, seq, ts)", () => {
    const { engine, send, events, out } = setup();
    engine.onSubscribed(Date.now());
    const sos = '{"level":"DANGER","presses":10,"seq":12,"ts":"2026-10-30T01:59:58Z","lat":6.52,"lon":3.37,"age":4}';
    send("sos", sos);
    send("sos", sos); // firmware retry
    send("sos", sos.replace('"seq":12', '"seq":13').replace("01:59:58", "01:59:59"));
    const sosEvents = events("sos");
    expect(sosEvents).toHaveLength(2);
    expect(sosEvents[0]).toMatchObject({ severity: "critical", lat: 6.52, lon: 3.37, ageSec: 4, tsApprox: false });
    expect(out.filter((m) => m.type === "event.added")).toHaveLength(2);
  });

  it("the same seq on another device is not a duplicate", () => {
    const { engine, events } = setup();
    const sos = '{"level":"SUSPICIOUS","presses":1,"seq":1,"ts":"2026-10-30T01:59:58Z","lat":null,"lon":null,"age":-1}';
    engine.handle("devices/a/sos", sos, Date.now());
    engine.handle("devices/b/sos", sos, Date.now());
    expect(events("sos")).toHaveLength(2);
  });

  it("SOS with null ts is stored with receive time and flagged approx", () => {
    const { send, events } = setup();
    send("sos", '{"level":"SUSPICIOUS","presses":1,"seq":1,"ts":null,"lat":null,"lon":null,"age":-1}');
    expect(events("sos")[0]).toMatchObject({ ts: T0, tsApprox: true, lat: null, lon: null, ageSec: null });
  });

  it("logs a reboot when seq/up go down", () => {
    const { send, events } = setup();
    send("heartbeat", '{"seq":690,"up":1411}');
    vi.advanceTimersByTime(2_000);
    send("heartbeat", '{"seq":691,"up":1413}');
    vi.advanceTimersByTime(2_000);
    send("heartbeat", '{"seq":0,"up":2}');
    const reboots = events("reboot");
    expect(reboots).toHaveLength(1);
    expect(reboots[0].payload).toEqual({ prevSeq: 691, prevUp: 1413, seq: 0, up: 2 });
  });

  it("null telemetry never creates a position or a (0,0) device location", () => {
    const { db, engine, send } = setup();
    send("telemetry", '{"ts":"2026-10-30T01:44:26Z","lat":null,"lon":null}');
    send("telemetry", '{"ts":"2026-10-30T01:44:36Z","lat":0,"lon":0}');
    expect(repo.track(db, ID, 0, Date.now() + 1)).toHaveLength(0);
    const v = engine.view(ID, Date.now())!;
    expect(v).toMatchObject({ lat: null, lon: null, gps: "none" });
  });

  it("stores positions, skips identical repeats within 10 s, and derives live / last known", () => {
    const { db, engine, send, out } = setup();
    send("telemetry", '{"ts":"2026-10-30T02:00:00Z","lat":6.524412,"lon":3.379201}');
    send("telemetry", '{"ts":"2026-10-30T02:00:05Z","lat":6.524412,"lon":3.379201}'); // duplicate within 10 s
    vi.advanceTimersByTime(10_000);
    send("telemetry", '{"ts":"2026-10-30T02:00:10Z","lat":6.5251,"lon":3.3799}');
    expect(repo.track(db, ID, 0, Date.now() + 1)).toHaveLength(2);
    expect(out.filter((m) => m.type === "position.added")).toHaveLength(2);
    expect(engine.view(ID, Date.now())!.gps).toBe("live");
    vi.advanceTimersByTime(61_000);
    engine.tick(Date.now());
    expect(engine.view(ID, Date.now())!.gps).toBe("last_known");
  });

  it("a parked device that keeps sending the same fix stays live; the fix time tracks the last one", () => {
    const { engine, send } = setup();
    for (let i = 0; i < 12; i++) {
      send("telemetry", `{"ts":"${new Date(Date.now()).toISOString()}","lat":6.524412,"lon":3.379201}`);
      vi.advanceTimersByTime(10_000);
      engine.tick(Date.now());
    }
    const v = engine.view(ID, Date.now())!;
    expect(v.gps).toBe("live");
    expect(v.fixTs).toBe(T0 + 110_000);
    expect(v.fixChangedAt).toBe(T0);
    vi.advanceTimersByTime(60_000);
    engine.tick(Date.now());
    expect(engine.view(ID, Date.now())!.gps).toBe("last_known");
  });

  it("late telemetry is kept in history but does not move the current position back", () => {
    const { db, engine, send } = setup();
    send("telemetry", '{"ts":"2026-10-30T02:00:10Z","lat":6.53,"lon":3.38}');
    send("telemetry", '{"ts":"2026-10-30T01:59:00Z","lat":6.50,"lon":3.35}');
    expect(engine.view(ID, Date.now())).toMatchObject({ lat: 6.53, lon: 3.38 });
    expect(repo.track(db, ID, 0, Date.now() + 60_000).map((p) => p.lat)).toEqual([6.5, 6.53]);
  });

  it("motion events keep the newest state even when an older one arrives late", () => {
    const { engine, send, events } = setup();
    send(
      "motion",
      '{"state":"SUSPICIOUS","prev":"CANDIDATE","indicator":"SUSPECTED_DISTRESS","ts":"2026-10-30T01:45:01Z","lat":null,"lon":null,"age":-1}',
    );
    send("motion", '{"state":"CANDIDATE","prev":"NORMAL","ts":"2026-10-30T01:45:00Z","lat":null,"lon":null,"age":-1}');
    send("motion", '{"state":"CANDIDATE","prev":"NORMAL","ts":"2026-10-30T01:45:00Z","lat":null,"lon":null,"age":-1}'); // QoS 1 redelivery
    expect(engine.view(ID, Date.now())).toMatchObject({ motionState: "SUSPICIOUS", motionIndicator: "SUSPECTED_DISTRESS" });
    const m = events("motion");
    expect(m.map((e) => e.type === "motion" && e.payload.state)).toEqual(["SUSPICIOUS", "CANDIDATE"]); // ordered by ts desc
    expect(m[0].severity).toBe("warning");
    expect(engine.getStats(Date.now()).motionAlerts24h).toBe(1);
  });

  it("derived status: online → signal lost → online, then Last Will → offline (with events after warm-up)", () => {
    const { engine, send, events } = setup();
    engine.onSubscribed(Date.now());
    send("status", "online", true);
    let seq = 1;
    const beat = () => send("heartbeat", JSON.stringify({ seq: seq++, up: seq * 2 }));
    beat();
    run(engine, WARMUP_MS + 2_000, beat);
    expect(engine.view(ID, Date.now())!.connection).toBe("online");
    expect(engine.view(ID, Date.now())!.linkQuality).toBe(100);

    run(engine, 9_000); // heartbeats stop (simulator --drop)
    expect(engine.view(ID, Date.now())!.connection).toBe("signal_lost");

    beat();
    engine.tick(Date.now());
    expect(engine.view(ID, Date.now())!.connection).toBe("online");

    send("status", "offline"); // broker Last Will
    expect(engine.view(ID, Date.now())).toMatchObject({ connection: "offline", connectionReason: "last_will" });

    const transitions = events("status").map((e) => (e.type === "status" ? `${e.payload.from}>${e.payload.to}` : ""));
    expect(transitions.reverse()).toEqual(["offline>online", "online>signal_lost", "signal_lost>online", "online>offline"]);
  });

  it("goes offline after 60 s of total silence", () => {
    const { engine, send } = setup();
    engine.onSubscribed(Date.now());
    send("status", "online");
    send("heartbeat", '{"seq":1,"up":1}');
    run(engine, 61_000);
    expect(engine.view(ID, Date.now())).toMatchObject({ connection: "offline", connectionReason: "no_messages" });
  });

  it("does not record transitions during warm-up or while the broker link is down", () => {
    const { engine, send, events } = setup();
    engine.onSubscribed(Date.now());
    send("status", "online", true);
    run(engine, WARMUP_MS - 1_000); // signal lost inside warm-up: not recorded
    expect(events("status")).toHaveLength(0);
    engine.onDisconnected();
    run(engine, 120_000);
    expect(events("status")).toHaveLength(0);
  });

  it("persists device state and survives a restart without spurious transitions", () => {
    const { db, engine, send } = setup();
    engine.onSubscribed(Date.now());
    send("status", "online");
    let seq = 1;
    const beat = () => send("heartbeat", JSON.stringify({ seq: seq++, up: seq * 2 }));
    run(engine, WARMUP_MS + 4_000, beat);
    engine.flush();

    const restarted = new Engine(db, () => {}, { topicRoot: "devices", log: silent });
    restarted.onSubscribed(Date.now());
    restarted.handle(`devices/${ID}/status`, "online", Date.now(), true);
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(2_000);
      restarted.handle(`devices/${ID}/heartbeat`, JSON.stringify({ seq: seq++, up: seq * 2 }), Date.now());
      restarted.tick(Date.now());
    }
    expect(restarted.view(ID, Date.now())!.connection).toBe("online");
    expect(repo.listEvents(db, { types: ["status"] }).events).toHaveLength(1); // only the original offline>online
    expect(repo.listEvents(db, { types: ["reboot"] }).events).toHaveLength(0);
  });

  it("a retained offline replayed after a restart keeps the real last-seen time", () => {
    const { db, engine, send } = setup();
    send("status", "online");
    send("heartbeat", '{"seq":1,"up":2}');
    send("status", "offline");
    engine.flush();
    const lastSeen = Date.now();

    vi.advanceTimersByTime(5 * 60_000);
    const restarted = new Engine(db, () => {}, { topicRoot: "devices", log: silent });
    restarted.onSubscribed(Date.now());
    restarted.handle(`devices/${ID}/status`, "offline", Date.now(), true);
    restarted.tick(Date.now());
    expect(restarted.view(ID, Date.now())).toMatchObject({ connection: "offline", lastSeen });

    // A device first heard of through a retained message has never been seen live.
    restarted.handle("devices/sim-404/status", "offline", Date.now(), true);
    expect(restarted.view("sim-404", Date.now())).toMatchObject({ connection: "offline", lastSeen: null });
  });

  it("invalid messages are stored raw and never throw", () => {
    const { sqlite, send } = setup();
    expect(() => send("heartbeat", "{oops")).not.toThrow();
    expect(() => send("battery", "{}")).not.toThrow();
    const raw = sqlite.prepare("select topic, error from raw_messages where error is not null").all();
    expect(raw).toHaveLength(2);
  });

  it("acknowledging with includeEarlier closes the whole SOS incident", () => {
    const { db, send } = setup();
    send("sos", '{"level":"SUSPICIOUS","presses":1,"seq":1,"ts":"2026-10-30T01:59:00Z","lat":null,"lon":null,"age":-1}');
    send("sos", '{"level":"DANGER","presses":10,"seq":10,"ts":"2026-10-30T01:59:50Z","lat":6.5,"lon":3.3,"age":2}');
    const [danger] = repo.activeSos(db);
    const acked = repo.acknowledgeEvent(db, danger.id, "op", Date.now(), true);
    expect(acked).toHaveLength(2);
    expect(repo.activeSos(db)).toHaveLength(0);
  });
});
