/**
 * Zero-dependency local MQTT broker for development when Docker isn't available.
 * Supports retained messages and Last Will, which is all the device contract needs.
 *
 *   npm run broker            # mqtt://localhost:1883
 *   npm run broker -- --port 1884
 */
import net from "node:net";
import { Aedes } from "aedes";

const portArg = process.argv.indexOf("--port");
const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 1883;
const verbose = process.argv.includes("--verbose");

const broker = await Aedes.createBroker();
const server = net.createServer(broker.handle);

broker.on("client", (c) => console.log(`[broker] + ${c.id}`));
broker.on("clientDisconnect", (c) => console.log(`[broker] - ${c.id}`));
broker.on("subscribe", (subs, c) => console.log(`[broker] ${c?.id} subscribed ${subs.map((s) => s.topic).join(", ")}`));
if (verbose) {
  broker.on("publish", (p, c) => {
    if (c) console.log(`[broker] ${c.id} → ${p.topic} ${p.payload.toString().slice(0, 120)}`);
  });
}

server.listen(port, () => console.log(`[broker] listening on mqtt://localhost:${port}`));

const stop = () => {
  server.close();
  broker.close(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
