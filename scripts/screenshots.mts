/**
 * Playwright screenshots of the main pages at phone / tablet / desktop sizes.
 *
 *   npm run screenshots -- --label fix --device sim-001
 *   npm run screenshots -- --label sos --device sim-001 --dark
 *
 * Flags:
 *   --base <url>       app URL (default http://localhost:3000)
 *   --label <name>     prefix for the output files (default "shot")
 *   --device <id>      device for the detail page (default: first device from /api/devices)
 *   --keyless          when no Maps key is configured, load Google Maps without a key
 *                      (renders a dimmed "for development purposes only" map) so markers,
 *                      trails and overlays can still be checked. Test-time only: the app is untouched.
 *   --dark             dark colour scheme
 *   --pages a,b        subset of: fleet, detail, alerts, settings, devices, login
 *   --chromium <path>  Chromium executable (defaults to Playwright's bundled browser)
 *
 * Output: screenshots/<label>-<page>-<w>x<h>[-dark].png, plus console errors printed at the end.
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

// Same parser as Next.js, so quoting and $ escapes in .env mean the same thing for scripts and the app.
nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const argv = process.argv.slice(2);
const opt = (n: string, d?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const flag = (n: string) => argv.includes(`--${n}`);

const BASE = opt("base", "http://localhost:3000")!;
const LABEL = opt("label", "shot")!;
const DARK = flag("dark");
const KEYLESS = flag("keyless");
const PAGES = (opt("pages", "fleet,detail,alerts") ?? "").split(",");
const OUT = path.resolve("screenshots");
const SIZES = [
  { w: 390, h: 844, mobile: true },
  { w: 820, h: 1180, mobile: false },
  { w: 1440, h: 900, mobile: false },
];

fs.mkdirSync(OUT, { recursive: true });
const problems: string[] = [];

async function prepare(ctx: BrowserContext) {
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { password: process.env.DASHBOARD_PASSWORD, name: "Playwright" } });
  if (!r.ok()) throw new Error(`login failed: ${r.status()} ${await r.text()}`);
  if (KEYLESS) {
    await ctx.route("**/api/config", async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { mapsApiKey: string | null };
      if (!body.mapsApiKey) body.mapsApiKey = "PLAYWRIGHT_KEYLESS";
      await route.fulfill({ response: res, json: body });
    });
    await ctx.route(/maps\.googleapis\.com\/maps\/api\/js/, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("key") === "PLAYWRIGHT_KEYLESS") url.searchParams.delete("key");
      await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
    });
  }
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);
  // Dismiss Google's keyless "can't load correctly" dialog if present.
  const ok = page.locator(".dismissButton");
  if (await ok.count())
    await ok
      .first()
      .click({ timeout: 1000 })
      .catch(() => {});
  await page.waitForTimeout(800);
}

const browser = await chromium.launch({ executablePath: opt("chromium") });
let deviceId = opt("device");

for (const size of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 1,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    colorScheme: DARK ? "dark" : "light",
  });
  await prepare(ctx);
  if (!deviceId) {
    const r = await ctx.request.get(`${BASE}/api/devices`);
    deviceId = ((await r.json()) as { devices: { id: string }[] }).devices[0]?.id;
  }
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`[${size.w}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/maps\.googleapis|Google Maps JavaScript API|ApiProjectMapError|favicon/.test(m.text())) {
      problems.push(`[${size.w}] console: ${m.text().slice(0, 200)}`);
    }
  });

  const targets: [string, string][] = [
    ["fleet", "/"],
    ["detail", deviceId ? `/devices/${encodeURIComponent(deviceId)}` : "/devices/none"],
    ["alerts", "/alerts"],
    ["devices", "/devices"],
    ["settings", "/settings"],
  ];
  for (const [name, url] of targets) {
    if (!PAGES.includes(name)) continue;
    await page.goto(`${BASE}${url}`);
    await settle(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) problems.push(`[${size.w}] ${name}: horizontal overflow of ${overflow}px`);
    const file = path.join(OUT, `${LABEL}-${name}-${size.w}x${size.h}${DARK ? "-dark" : ""}.png`);
    await page.screenshot({ path: file });
    console.log(`saved ${path.relative(process.cwd(), file)}`);
  }
  if (PAGES.includes("login")) {
    const anon = await browser.newContext({ viewport: { width: size.w, height: size.h }, colorScheme: DARK ? "dark" : "light" });
    const p = await anon.newPage();
    await p.goto(`${BASE}/login`);
    await p.waitForTimeout(1500);
    const file = path.join(OUT, `${LABEL}-login-${size.w}x${size.h}${DARK ? "-dark" : ""}.png`);
    await p.screenshot({ path: file });
    console.log(`saved ${path.relative(process.cwd(), file)}`);
    await anon.close();
  }
  await ctx.close();
}

await browser.close();
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.log(" -", p);
} else {
  console.log("\nNo console errors, page errors or horizontal overflow.");
}
