import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));

const pascal = (sel) =>
  String(sel).split(/[-_\s]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

const normalise = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".js": "text/plain; charset=utf-8", ".jsx": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

/**
 * A screenshot belongs to a screen when their names agree once the noise is
 * gone. A guess that is wrong here shows the wrong picture next to the wrong
 * component, so an uncertain match is no match.
 */
function matchScreenshot(screen, screenshots) {
  const wanted = normalise(String(screen.selector).replace(/^app-/, ""));
  if (!wanted) return null;
  const scored = screenshots
    .map((shot) => {
      const name = normalise(shot.name);
      if (name === wanted) return { shot, score: 3 };
      if (name.startsWith(wanted) || wanted.startsWith(name)) return { shot, score: 2 };
      if (name.includes(wanted)) return { shot, score: 1 };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.shot.name.localeCompare(b.shot.name));
  return scored.length ? scored[0].shot : null;
}

export function buildRun(ctx, self = null) {
  const byPlugin = new Map();
  // The kernel records a hook's duration after it returns, so the plugin
  // writing this report cannot yet see itself in the timings. Leaving it out
  // would make the rack quietly one short of the plugins that ran.
  if (self && !(ctx.timings ?? []).some((t) => t.name === self)) {
    byPlugin.set(self, { name: self, class: "vis", ms: 0, stages: ["verify"], said: ["writing this report"] });
  }
  for (const t of ctx.timings ?? []) {
    if (!byPlugin.has(t.name)) byPlugin.set(t.name, { name: t.name, class: t.class, ms: 0, stages: [] });
    const entry = byPlugin.get(t.name);
    entry.ms += t.ms;
    entry.stages.push(t.stage);
  }
  for (const line of ctx.log?.transcript ?? []) {
    const entry = byPlugin.get(line.plugin);
    if (entry) (entry.said ??= []).push(line.message);
  }

  const components = (ctx.written ?? []).filter((f) => /\.(jsx|tsx)$/.test(f));
  const screens = (ctx.screens ?? []).map((screen) => {
    const name = String(screen.selector).replace(/^app-/, "");
    const expected = `${pascal(screen.selector)}.jsx`;
    const shot = matchScreenshot(screen, ctx.sources?.screenshots ?? []);
    return {
      name,
      component: components.find((f) => f.endsWith(expected)) ?? null,
      screenshot: shot ? shot.name + (extname(shot.path) || ".png") : null,
      state: shot?.state ?? null,
      matched: Boolean(shot),
      origin: screen.readBy === "observation" ? "observed" : "source",
      fields: (screen.observed?.fields ?? []).map((f) => f.name),
    };
  });

  const endpoints = (ctx.api?.calls ?? []).map((call) => ({
    method: call.method,
    path: call.path,
    origin: call.observed ? "observed" : "source",
    body: call.body ?? null,
  }));

  return {
    ranAt: new Date().toISOString(),
    out: ctx.config.out,
    plugins: [...byPlugin.values()].map((p) => ({
      name: p.name,
      class: p.class,
      ms: p.ms,
      stages: [...new Set(p.stages)],
      // Absolute paths are noise in a panel this narrow, and they are somebody
      // else's directory layout.
      contributed: (p.said ?? [])
        .map((line) => line.split(ctx.config.out).join("./out").split(ctx.config.src).join("./src"))
        .join(" · ") || "nothing to report",
    })),
    screens,
    endpoints: endpoints.filter(
      (e, i) => endpoints.findIndex((o) => o.method === e.method && o.path === e.path) === i
    ),
    unverified: ctx.report?.unverified ?? [],
    notes: ctx.plan?.notes ?? [],
    improvements: ctx.improvements ?? [],
    files: ctx.written ?? [],
    tokens: ctx.tokens ?? null,
  };
}

/** Never serve anything outside the directory that was opened. */
function within(base, requested) {
  const full = resolve(base, "." + sep + requested);
  const rel = relative(base, full);
  return rel && !rel.startsWith("..") && !rel.startsWith(sep) ? full : null;
}

export async function serve({ outDir, shotsDir, port = 4321, log = console, rerun = null }) {
  const runPath = join(outDir, ".portamp", "run.json");
  const shell = await readFile(join(here, "app.html"), "utf8");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, type, body) => {
      res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(body);
    };

    try {
      if (url.pathname === "/") return send(200, TYPES[".html"], shell);

      // The one thing the UI may cause: running the tool again. It still does
      // not edit a file, and the pipeline remains the only thing that writes.
      if (url.pathname === "/rerun" && req.method === "POST") {
        if (!rerun) return send(501, TYPES[".json"], '{"error":"this server was started without a way to re run"}');
        const started = Date.now();
        try {
          await rerun();
          return send(200, TYPES[".json"], JSON.stringify({ ok: true, ms: Date.now() - started }));
        } catch (err) {
          // A policy stop is a result, not a crash. The UI shows it.
          return send(200, TYPES[".json"], JSON.stringify({ ok: false, error: err.message, ms: Date.now() - started }));
        }
      }
      if (url.pathname === "/run.json") return send(200, TYPES[".json"], await readFile(runPath, "utf8"));

      if (url.pathname.startsWith("/shots/")) {
        const file = within(shotsDir, decodeURIComponent(url.pathname.slice(7)));
        if (!file) return send(403, TYPES[".json"], '{"error":"outside the shots directory"}');
        // Read the file before answering. Writing the header first and then
        // discovering the stream failed leaves no way to say so.
        const bytes = await readFile(file);
        if (!bytes.length) return send(200, TYPES[".json"], '{"placeholder":"this screenshot file is empty"}');
        return send(200, TYPES[extname(file)] ?? "application/octet-stream", bytes);
      }

      if (url.pathname === "/source") {
        const file = within(outDir, decodeURIComponent(url.searchParams.get("path") ?? ""));
        if (!file) return send(403, TYPES[".json"], '{"error":"outside the output directory"}');
        return send(200, TYPES[".js"], await readFile(file, "utf8"));
      }

      send(404, TYPES[".json"], '{"error":"not found"}');
    } catch (err) {
      send(err.code === "ENOENT" ? 404 : 500, TYPES[".json"], JSON.stringify({ error: err.message }));
    }
  });

  await new Promise((ok, fail) => {
    // 127.0.0.1, never 0.0.0.0. It serves screenshots of a customer system.
    server.listen(port, "127.0.0.1", ok).on("error", fail);
  });

  const address = `http://127.0.0.1:${server.address().port}`;
  log.info?.(`portamp ui on ${address}`);
  return { server, address };
}

/** Mac, Windows and Linux each have their own opener, and a headless box has none. */
export function openBrowser(address) {
  const opener =
    process.platform === "darwin" ? ["open", [address]]
      : process.platform === "win32" ? ["cmd", ["/c", "start", "", address]]
        : ["xdg-open", [address]];
  try {
    const child = spawn(opener[0], opener[1], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    // Detached and unreferenced, so ctrl c on the server leaves nothing behind.
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes what the run did, for the UI to read. The Winamp slot: the core does
 * the work, the visualization plugin shows it. Nothing here is needed to port
 * anything, and nothing here writes into the port.
 */
export default {
  name: "vis-ui",
  version: "0.1.0",
  class: "vis",

  commands: {
    ui: {
      describe: "serve the last run on 127.0.0.1",
      async run({ config, log, args, runPipeline }) {
        const runPath = join(config.out, ".portamp", "run.json");
        const already = await readFile(runPath, "utf8").then(() => true).catch(() => false);

        if (!already || args.fresh) {
          await runPipeline();
        } else {
          log.info("serving the last run. Pass --fresh to run the pipeline again.\n");
        }

        const { server, address } = await serve({
          outDir: config.out,
          shotsDir: config.shots,
          port: Number(args.port) || 4321,
          log,
          rerun: runPipeline,
        });
        if (!openBrowser(address)) log.info("could not open a browser, open that address yourself");

        // Ctrl c closes the socket and leaves nothing behind; the browser was
        // spawned detached and unreferenced.
        const stop = () => server.close(() => process.exit(0));
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
      },
    },
  },

  setup({ on, log }) {
    on("verify", async (ctx) => {
      const run = buildRun(ctx, "vis-ui");
      const target = join(ctx.config.out, ".portamp", "run.json");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(run, null, 2) + "\n", "utf8");
      log.info(
        `run.json written, ${run.plugins.length} plugin(s), ${run.screens.length} screen(s), ` +
          `${run.unverified.length} unverified`
      );
    });
  },
};
