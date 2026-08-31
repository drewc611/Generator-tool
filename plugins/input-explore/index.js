import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SNAPSHOT } from "./probe.js";

/**
 * Uses a running legacy app the way a person would, and writes down what it
 * learns. Clicks things, fills forms, submits them empty to see what the
 * validation says, and records what changed each time: which screen appeared,
 * which request went out, what came back.
 *
 * input-record visits routes somebody already knew about. This one finds them.
 * That is the difference between photographing a system and understanding it.
 *
 * Three gates, none skippable:
 *   1. portamp.authorization.json, naming who owns the system.
 *   2. --allow-live, because this drives a real application.
 *   3. Anything that reads as destructive is skipped and listed, unless
 *      explore.allowDestructive says otherwise. Exploring somebody's admin
 *      panel should not delete a customer.
 *
 * Configure in portamp.config.js:
 *   explore: {
 *     baseUrl: "https://legacy.internal",
 *     maxSteps: 40,
 *     login: async (page) => { ... },
 *     sampleValues: { customer: "Test Customer" },
 *     allowDestructive: false,
 *   }
 */

const DESTRUCTIVE = /\b(delete|remove|destroy|drop|purge|deactivate|disable|revoke|cancel subscription|unsubscribe|pay|charge|checkout|place order|send|publish|archive|reset)\b/i;
const SAMPLE = { email: "test@example.com", number: "1", date: "2026-01-01", tel: "5551234567", url: "https://example.com" };

/**
 * Two records shown by the same screen are one screen, not two. Anything that
 * looks like an identifier is replaced before the signature is taken, or the
 * model grows a screen per row and describes a database instead of a product.
 */
export function generalise(text) {
  return String(text ?? "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ":id")
    .replace(/\b[A-Za-z]{1,4}[-_]?\d{2,}\b/g, ":id")
    .replace(/\b\d[\d.,]*\b/g, ":n");
}

export const signatureOf = (snap) =>
  [generalise(snap.url), snap.regions.join("|"), generalise(snap.headings.join("|"))].join(" :: ");

function classify(element) {
  const label = `${element.name} ${element.id ?? ""} ${element.href ?? ""}`.trim();
  if (DESTRUCTIVE.test(label)) return { safe: false, reason: `"${element.name || element.id}" reads as destructive` };
  if (element.disabled) return { safe: false, reason: "disabled" };
  return { safe: true };
}

function valueFor(element, samples) {
  const key = element.id || element.name || element.placeholder || "";
  for (const [k, v] of Object.entries(samples || {})) {
    if (key.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return SAMPLE[element.type] ?? "Test value";
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error(
      "input-explore needs playwright. Run `npm i -D playwright && npx playwright install chromium`, or drop explore from the config."
    );
  }
}

export default {
  name: "input-explore",
  version: "0.1.0",
  class: "input",
  setup({ on, log, policy }) {
    on("scan", async (ctx) => {
      const cfg = ctx.config.explore;
      if (!cfg?.baseUrl) return log.debug("no explore config");

      if (!ctx.authorization) {
        throw new Error(
          "Driving a legacy system requires portamp.authorization.json naming the system and who owns it."
        );
      }
      policy.assertLiveAllowed(cfg.baseUrl);

      const { chromium } = await loadPlaywright();
      const maxSteps = cfg.maxSteps ?? 40;
      const origin = new URL(cfg.baseUrl).origin;

      // Some environments pin their own browser build rather than letting
      // playwright fetch one. Honour that instead of demanding a download.
      const browser = await chromium.launch(
        cfg.executablePath ? { executablePath: cfg.executablePath } : {}
      );
      const context = await browser.newContext({ viewport: cfg.viewport ?? { width: 1440, height: 900 } });
      const page = await context.newPage();

      let recording = [];
      page.on("request", (r) => recording.push({ kind: "request", method: r.method(), url: r.url(), body: r.postData() }));
      page.on("response", async (r) => {
        const entry = recording.find((e) => e.kind === "request" && e.url === r.url() && !e.status);
        if (entry) {
          entry.status = r.status();
          entry.contentType = r.headers()["content-type"] ?? null;
        }
      });

      const settle = async () => {
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(120);
      };

      const goHome = async () => {
        await page.goto(cfg.baseUrl, { waitUntil: "networkidle" });
        if (typeof cfg.login === "function") await cfg.login(page);
        await settle();
      };

      const screens = new Map();
      const steps = [];
      const skipped = [];
      const requests = [];

      const remember = (snap) => {
        const signature = signatureOf(snap);
        if (!screens.has(signature)) {
          screens.set(signature, { id: `screen-${screens.size + 1}`, signature, ...snap });
        }
        return screens.get(signature).id;
      };

      const drainRequests = () => {
        const seen = recording.filter((e) => e.kind === "request" && e.url.startsWith(origin));
        recording = [];
        return seen.map((r) => {
          const u = new URL(r.url);
          const entry = {
            method: r.method,
            path: u.pathname,
            query: [...u.searchParams.keys()],
            status: r.status ?? null,
            body: r.body ?? null,
            json: (r.contentType ?? "").includes("json"),
          };
          requests.push(entry);
          return entry;
        });
      };

      try {
        await goHome();
        drainRequests();
        const start = await page.evaluate(SNAPSHOT);
        const startId = remember(start);

        // Breadth first over what the current screen offers. Each action is
        // performed from a fresh load so one step cannot poison the next.
        const attempted = new Set();
        const exercised = new Set();
        const queue = [];
        for (const el of start.elements) {
          attempted.add(`|${el.selector}`);
          queue.push({ from: startId, element: el, path: [] });
        }
        let performed = 0;

        while (queue.length && performed < maxSteps) {
          const item = queue.shift();
          const verdict = classify(item.element);
          if (!verdict.safe) {
            if (!cfg.allowDestructive || item.element.disabled) {
              skipped.push({ selector: item.element.selector, name: item.element.name, reason: verdict.reason });
              continue;
            }
          }

          const done = `${item.from}|${item.path.map((a) => a.kind + a.selector).join(">")}|${item.element.selector}`;
          if (exercised.has(done)) continue;
          exercised.add(done);

          await goHome();
          for (const earlier of item.path) {
            const target = page.locator(earlier.selector).first();
            if (earlier.kind === "fill") await target.fill(earlier.value, { timeout: 3000 }).catch(() => {});
            else await target.click({ timeout: 3000 }).catch(() => {});
            await settle();
          }
          drainRequests();

          const before = await page.evaluate(SNAPSHOT);
          const beforeId = remember(before);
          const locator = page.locator(item.element.selector).first();
          if (!(await locator.count().catch(() => 0))) continue;

          let action = { kind: "click", selector: item.element.selector, label: item.element.name };
          try {
            if (["input", "textarea"].includes(item.element.tag) && item.element.type !== "submit") {
              const value = valueFor(item.element, cfg.sampleValues);
              await locator.fill(value, { timeout: 3000 });
              action = { kind: "fill", selector: item.element.selector, label: item.element.name, value };
            } else {
              await locator.click({ timeout: 3000 });
            }
          } catch (err) {
            skipped.push({ selector: item.element.selector, name: item.element.name, reason: `could not interact: ${err.message.split("\n")[0]}` });
            continue;
          }
          await settle();
          performed += 1;

          const fired = drainRequests();
          const after = await page.evaluate(SNAPSHOT);
          const afterId = remember(after);

          const beforeText = new Set(before.text.split(". "));
          const messages = after.text
            .split(". ")
            .filter((line) => line && !beforeText.has(line))
            .slice(0, 6);

          steps.push({
            from: beforeId,
            // How this step was reached. Without it a replay starts at the
            // home screen and clicks a control that is three screens away.
            path: item.path.map((a) => ({ kind: a.kind, selector: a.selector, label: a.label, value: a.value })),
            action,
            to: afterId,
            changed: beforeId !== afterId,
            requests: fired,
            messages,
          });

          // A step that revealed a new screen is worth exploring onward from.
          // Explore onward from anything new. A fill that changed nothing on
          // screen is still worth carrying forward, because the thing it
          // enables is usually the button next to it.
          const worthContinuing = afterId !== beforeId || action.kind === "fill";
          if (worthContinuing && item.path.length < 3) {
            for (const el of after.elements) {
              const next = { from: afterId, element: el, path: [...item.path, action] };
              const key = `${next.path.map((a) => a.kind + a.selector).join(">")}|${el.selector}`;
              if (attempted.has(key)) continue;
              attempted.add(key);
              queue.push(next);
            }
          }
        }

        const document = {
          baseUrl: cfg.baseUrl,
          recordedAt: new Date().toISOString(),
          screens: [...screens.values()],
          steps,
          requests,
          skipped,
          budget: { maxSteps, performed },
        };

        const outDir = ctx.config.shots;
        await mkdir(outDir, { recursive: true });
        await writeFile(join(outDir, "exploration.json"), JSON.stringify(document, null, 2) + "\n", "utf8");

        ctx.sources.exploration = document;
        ctx.sources.observedStyles.push(
          ...document.screens.map((s) => ({
            route: s.id,
            font: s.font,
            pageBackground: s.pageBackground,
            sample: s.sample,
            rowHeights: s.rowHeights,
          }))
        );

        log.info(
          `${document.screens.length} screen(s), ${steps.length} step(s), ` +
            `${requests.length} request(s), ${skipped.length} skipped`
        );
        ctx.unverified(
          `The model came from using the app, not from reading it. ${performed} of ${maxSteps} steps were taken; ` +
            "anything never reached does not exist in this model."
        );
        if (skipped.length) {
          ctx.unverified(
            `${skipped.length} control(s) were not exercised, most because they read as destructive. ` +
              "They are listed in BEHAVIOR_MODEL.md and none of them is described here."
          );
        }
      } finally {
        await context.close();
        await browser.close();
      }
    });
  },
};
