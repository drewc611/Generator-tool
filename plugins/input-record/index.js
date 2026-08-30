/**
 * Drives a running legacy app with Playwright and records what it observes:
 * a screenshot per route and state, a HAR of every request the app makes, and
 * the computed styles that let the token extractor recover a real design system
 * instead of guessing.
 *
 * This is the answer for a legacy app with no source. You cannot read the code,
 * but you can watch the thing run and write down exactly what it does.
 *
 * Two gates, both required, neither skippable:
 *   1. portamp.authorization.json must be on disk, naming who owns the system.
 *   2. --allow-live, because this drives a real application.
 *
 * Playwright is an optional dependency. Install it only if you record:
 *   npm i -D playwright && npx playwright install chromium
 *
 * Configure in portamp.config.js:
 *   record: {
 *     baseUrl: "https://legacy.internal",
 *     routes: [
 *       { path: "/orders", name: "orders-default" },
 *       { path: "/orders?empty=1", name: "orders-empty" },
 *     ],
 *     login: async (page) => { ... },     // your own auth, your own credentials
 *     viewport: { width: 1440, height: 900 },
 *     redact: ["[data-pii]", ".customer-name"],
 *   }
 */

const STYLE_PROBE = () => {
  const pick = (sel) => document.querySelector(sel);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const body = cs(document.body);
  const sample = [...document.querySelectorAll("h1,h2,h3,p,td,th,label,button,input")]
    .slice(0, 400)
    .map((el) => {
      const s = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        fontSize: parseFloat(s.fontSize),
        fontWeight: s.fontWeight,
        color: s.color,
        background: s.backgroundColor,
        radius: parseFloat(s.borderTopLeftRadius) || 0,
        padY: parseFloat(s.paddingTop) || 0,
        height: Math.round(el.getBoundingClientRect().height),
      };
    });
  return {
    font: body?.fontFamily,
    pageBackground: body?.backgroundColor,
    sample,
    rowHeights: [...document.querySelectorAll("tr")]
      .slice(0, 60)
      .map((r) => Math.round(r.getBoundingClientRect().height)),
  };
};

export default {
  name: "input-record",
  version: "0.1.0",
  class: "input",
  setup({ on, log, policy }) {
    on("scan", async (ctx) => {
      const cfg = ctx.config.record;
      if (!cfg?.baseUrl) return log.debug("no record config, skipping");

      if (!ctx.authorization)
        throw new Error(
          "Recording drives a real application. Create portamp.authorization.json " +
            "naming the system and who owns it before recording anything."
        );
      if (ctx.authorization.sourceAvailable === false)
        log.info("no source on file, recording is the primary input");
      policy.assertLiveAllowed(cfg.baseUrl);

      let chromium;
      try {
        ({ chromium } = await import("playwright"));
      } catch {
        throw new Error(
          "Recording needs Playwright. Install it with:\n" +
            "  npm i -D playwright && npx playwright install chromium"
        );
      }

      const harPath = `${ctx.config.out}/recording/network.har`;
      const browser = await chromium.launch();
      const context = await browser.newContext({
        viewport: cfg.viewport || { width: 1440, height: 900 },
        recordHar: { path: harPath, content: "omit" },
      });
      const page = await context.newPage();

      const requests = [];
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (u.origin !== new URL(cfg.baseUrl).origin) return; // only the app's own calls
        requests.push({
          method: r.method(),
          path: u.pathname,
          query: [...u.searchParams.keys()],
          headers: Object.keys(r.headers()).filter(
            (h) => !["cookie", "authorization"].includes(h.toLowerCase())
          ),
          hasBody: Boolean(r.postData()),
        });
      });

      try {
        if (typeof cfg.login === "function") {
          log.info("running the login step you supplied");
          await cfg.login(page);
        }

        for (const route of cfg.routes || []) {
          const url = new URL(route.path, cfg.baseUrl).href;
          log.info(`recording ${route.name}`);
          await page.goto(url, { waitUntil: "networkidle" });
          if (route.prepare) await route.prepare(page);

          // Blank anything the user flagged as customer data before the shutter.
          for (const sel of cfg.redact || []) {
            await page
              .locator(sel)
              .evaluateAll((els) =>
                els.forEach((el) => {
                  el.style.filter = "blur(6px)";
                  el.setAttribute("data-portamp-redacted", "true");
                })
              )
              .catch(() => {});
          }

          const shot = `${ctx.config.shots}/${route.name}.png`;
          await page.screenshot({ path: shot, fullPage: true });
          ctx.sources.screenshots.push({
            path: shot,
            name: route.name,
            recorded: true,
            state: route.state || "default",
          });

          const styles = await page.evaluate(STYLE_PROBE);
          ctx.sources.observedStyles = ctx.sources.observedStyles || [];
          ctx.sources.observedStyles.push({ route: route.name, ...styles });
        }
      } finally {
        await context.close(); // flushes the HAR
        await browser.close();
      }

      // Fold observed traffic into the same shape the source reader produces,
      // so every downstream plugin treats recorded and read calls identically.
      const seen = new Set();
      for (const r of requests) {
        const key = `${r.method} ${r.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ctx.api.calls.push({
          method: r.method,
          path: r.path,
          file: "recorded",
          headers: r.headers,
          body: r.hasBody ? "observed, shape not captured" : null,
          observed: true,
        });
      }

      log.info(
        `recorded ${ctx.sources.screenshots.filter((s) => s.recorded).length} screen(s), ` +
          `${seen.size} distinct call(s), HAR at ${harPath}`
      );
      ctx.unverified(
        "Calls were observed, not read from source. A path never exercised during " +
          "recording does not exist in this inventory. Walk every screen and state."
      );
      if (!(cfg.redact || []).length)
        ctx.unverified(
          "No redaction selectors were configured. Check the screenshots and the HAR " +
            "for customer data before committing either."
        );
    });
  },
};
