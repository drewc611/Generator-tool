import { createServer } from "node:http";
import { readdir, readFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { pascal } from "../dsp-ir/emit.js";
import { intakePath, rerunOptions } from "./lib.js";

const here = dirname(fileURLToPath(import.meta.url));


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
    provenance: ctx.provenance ?? {},
    tokens: ctx.tokens ?? null,
    // What the other vis plugins measured, riding the same sidecar: coverage
    // from vis-coverage and the equivalence verdicts, both of which run
    // earlier in this stage. The console shows them instead of re-deriving.
    coverage: ctx.coverage ?? null,
    parity: ctx.report?.parity ?? [],
  };
}

/**
 * The page the compare pane renders: the emitted element, live, in the state
 * the query names. Loading and error go through the element's own set();
 * the empty state is the element with nothing, which is the point of having
 * one. Values are escaped into the page; the state name is checked against a
 * list rather than echoed.
 */
export function previewPage(tag, rel, state) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const wanted = ["empty", "loading", "error", "rows"].includes(state) ? state : "empty";
  return `<!doctype html>
<meta charset="utf-8">
<title>preview: ${esc(tag)}</title>
<style>body { margin: 0; padding: 12px; background: #fff; font-family: system-ui, sans-serif; }
.invented { margin: 0 0 10px; padding: 3px 8px; font-size: 11px; color: #7c5a12; background: #fdf3dd; border: 1px solid #edd9a3; }</style>
${wanted === "rows" ? '<p class="invented">invented rows — this data came from nowhere near the legacy system</p>' : ""}
<${esc(tag)} id="el"></${esc(tag)}>
<script type="module">
  import "/elements/${encodeURIComponent(rel.split("/").pop())}";
  const el = document.getElementById("el");
  const state = ${JSON.stringify(wanted)};
  // Real pixels from the real element. Empty, loading and error carry no
  // data on purpose; the rows state uses rows invented here and labeled
  // above, exactly as the emitted stories do, so the body state is visible
  // without a byte of customer data reaching the pane.
  if (state === "loading") el.set({ loading: true });
  if (state === "error") el.set({ error: new Error("preview: a request failed") });
  if (state === "rows") el.set({ loading: false, error: null, data: [
    { id: 1, name: "Example row one", value: "example" },
    { id: 2, name: "Example row two", value: "example" },
  ] });
</script>
`;
}

/**
 * A run report, rendered where the run is already being read. Everything is
 * escaped first and the markdown that survives is the handful of shapes the
 * reports actually use: headings, tables, fences, lists, bold and code.
 */
export function reportPage(name, markdown) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = (s) => s
    .replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, (m, b) => `<strong>${b}</strong>`);
  const lines = esc(markdown).split("\n");
  const out = [];
  let inFence = false;
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^```/.test(line)) { closeList(); out.push(inFence ? "</pre>" : "<pre>"); inFence = !inFence; continue; }
    if (inFence) { out.push(line); continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { closeList(); out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    if (/^\|/.test(line)) {
      closeList();
      if (/^\|[\s\-|:]+\|$/.test(line)) continue;
      const cells = line.split("|").slice(1, -1).map((c) => `<td>${inline(c.trim())}</td>`).join("");
      const open = !/^\|/.test(lines[i - 1] ?? "") ? "<table>" : "";
      const close = !/^\|/.test(lines[i + 1] ?? "") ? "</table>" : "";
      out.push(`${open}<tr>${cells}</tr>${close}`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    closeList();
    if (line.trim() === "" || line.trim() === "---") { out.push(""); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inFence) out.push("</pre>");
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — portamp</title>
<style>
  body { margin: 0; padding: 18px 22px; background: #101013; color: #d7d7de;
         font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  main { max-width: 88ch; margin: 0 auto; }
  h1, h2, h3, h4 { color: #f0a830; letter-spacing: .4px; }
  h1 { font-size: 16px; } h2 { font-size: 13px; margin-top: 26px; }
  a { color: #7df3b0; }
  code { color: #7dd3fc; background: #04120b; padding: 0 3px; }
  pre { background: #04120b; border: 1px solid #0d3a24; padding: 10px 12px; overflow-x: auto; color: #7df3b0; }
  table { border-collapse: collapse; margin: 8px 0; }
  td { border: 1px solid #2b2b31; padding: 3px 9px; }
  tr:nth-child(odd) td { background: #071008; }
  .crumb { color: #5d5d68; font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase; margin-bottom: 14px; }
  .crumb a { color: #8b8b96; }
</style>
<main>
<p class="crumb"><a href="/">← console</a> · ${esc(name)}</p>
${out.join("\n")}
</main>
`;
}

/** Never serve anything outside the directory that was opened. */
function within(base, requested) {
  const full = resolve(base, "." + sep + requested);
  const rel = relative(base, full);
  return rel && !rel.startsWith("..") && !rel.startsWith(sep) ? full : null;
}

/** A request body up to a limit, or a 413 shaped error past it. */
function readBody(req, limit) {
  return new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { const err = new Error(`the body is over ${limit} bytes`); err.status = 413; req.destroy(); fail(err); return; }
      chunks.push(c);
    });
    req.on("end", () => done(Buffer.concat(chunks)));
    req.on("error", fail);
  });
}

/**
 * The console's intake: what a person dropped on it, written under the run's
 * own sidecar directory and never into the port. A rerun pointed at it reads
 * exactly those files, so an executable, a screenshot or a folder of old pages
 * becomes a port without a path typed anywhere. The server hands bytes here
 * and writes nothing itself.
 */
export function createIntake(dir) {
  const list = async (at = dir, base = "") => {
    const out = [];
    for (const e of await readdir(at, { withFileTypes: true }).catch(() => [])) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...(await list(join(at, e.name), rel)));
      else out.push({ path: rel, bytes: (await stat(join(at, e.name))).size });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  };
  return {
    dir,
    list: () => list(),
    async put(rel, bytes) {
      const target = intakePath(rel) ? within(dir, intakePath(rel)) : null;
      if (!target) throw new Error("a file may only land inside the intake");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      return list();
    },
    async clear() { await rm(dir, { recursive: true, force: true }); },
  };
}

export async function serve({ outDir, shotsDir, port = 4321, log = console, rerun = null, intake = null }) {
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

      // The console is installable. These are the app's own files, served from
      // beside app.html; nothing here touches the run or the customer system.
      if (url.pathname === "/manifest.webmanifest")
        return send(200, "application/manifest+json", await readFile(join(here, "manifest.webmanifest")));
      // TYPES[".js"] is text/plain on purpose, for /source. A worker script
      // is the one .js this server must declare as executable.
      if (url.pathname === "/sw.js")
        return send(200, "text/javascript; charset=utf-8", await readFile(join(here, "sw.js")));
      if (url.pathname === "/icon.svg" || url.pathname === "/favicon.ico")
        return send(200, "image/svg+xml", await readFile(join(here, "icon.svg")));
      // The console's pure logic, the same file the test suite imports.
      if (url.pathname === "/lib.js")
        return send(200, "text/javascript; charset=utf-8", await readFile(join(here, "lib.js")));

      // For anything pairing with this server: is it up, and which run does
      // it hold. Counts and a timestamp only; nothing from the run's content.
      if (url.pathname === "/healthz") {
        const held = await readFile(runPath, "utf8").then((t) => JSON.parse(t)).catch(() => null);
        return send(200, TYPES[".json"], JSON.stringify({
          ok: true,
          ranAt: held?.ranAt ?? null,
          screens: held?.screens?.length ?? 0,
          files: held?.files?.length ?? 0,
        }));
      }
      if (/^\/icons\/icon-(180|192|512)\.png$/.test(url.pathname))
        return send(200, "image/png", await readFile(join(here, "icons", url.pathname.slice(7))));

      // The one thing the UI may cause: running the tool again. It still does
      // not edit a file, and the pipeline remains the only thing that writes.
      if (url.pathname === "/rerun" && req.method === "POST") {
        if (!rerun) return send(501, TYPES[".json"], '{"error":"this server was started without a way to re run"}');
        const started = Date.now();
        try {
          // The request may name the source (the intake, or the tree the command was given) and the offered flags.
          const text = (await readBody(req, 65536)).toString("utf8");
          await rerun(rerunOptions(text ? JSON.parse(text) : {}));
          return send(200, TYPES[".json"], JSON.stringify({ ok: true, ms: Date.now() - started }));
        } catch (err) {
          // A policy stop is a result, not a crash. The UI shows it.
          return send(200, TYPES[".json"], JSON.stringify({ ok: false, error: err.message, ms: Date.now() - started }));
        }
      }
      // What a person handed the console lands in the intake the command owns; this server writes nothing itself,
      // and the port's own files are never the target.
      if (url.pathname === "/intake" && req.method === "POST") {
        if (!intake) return send(501, TYPES[".json"], '{"error":"this server was started without an intake"}');
        const rel = intakePath(url.searchParams.get("path") ?? "");
        if (!rel) return send(400, TYPES[".json"], '{"error":"the path must be a relative file path with no . or .. segment"}');
        let bytes;
        try { bytes = await readBody(req, 256 * 1024 * 1024); } catch (err) { return send(err.status ?? 500, TYPES[".json"], JSON.stringify({ error: err.message })); }
        const files = await intake.put(rel, bytes);
        return send(200, TYPES[".json"], JSON.stringify({ ok: true, path: rel, files: files.length }));
      }
      if (url.pathname === "/intake" && req.method === "DELETE") {
        if (!intake) return send(501, TYPES[".json"], '{"error":"this server was started without an intake"}');
        await intake.clear();
        return send(200, TYPES[".json"], '{"ok":true}');
      }
      if (url.pathname === "/intake.json") {
        return send(200, TYPES[".json"], JSON.stringify(intake ? { dir: intake.dir, files: await intake.list() } : { dir: null, files: [] }));
      }
      // The page polls this every few seconds; the timestamp is the version,
      // so an unchanged run costs a 304 instead of the whole document.
      if (url.pathname === "/run.json") {
        const body = await readFile(runPath, "utf8");
        const tag = `"${/"ranAt"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? String(body.length)}"`;
        if (req.headers["if-none-match"] === tag) {
          res.writeHead(304, { ETag: tag, "Cache-Control": "no-cache" });
          return res.end();
        }
        res.writeHead(200, { "Content-Type": TYPES[".json"], ETag: tag, "Cache-Control": "no-cache" });
        return res.end(body);
      }

      // The run's own markdown reports, listed and rendered where the run is
      // already being read. Only root level .md files the run wrote qualify;
      // the written list is the whitelist, not the directory.
      if (url.pathname === "/reports.json") {
        const held = await readFile(runPath, "utf8").then((t) => JSON.parse(t)).catch(() => ({ files: [] }));
        return send(200, TYPES[".json"], JSON.stringify((held.files ?? []).filter((f) => /\.md$/i.test(f) && !f.includes("/"))));
      }
      if (url.pathname === "/report") {
        const name = decodeURIComponent(url.searchParams.get("name") ?? "");
        const held = await readFile(runPath, "utf8").then((t) => JSON.parse(t)).catch(() => ({ files: [] }));
        const allowed = (held.files ?? []).includes(name) && /\.md$/i.test(name) && !name.includes("/");
        if (!allowed) return send(403, TYPES[".json"], '{"error":"only markdown reports this run wrote are served"}');
        const file = within(outDir, name);
        if (!file) return send(403, TYPES[".json"], '{"error":"outside the output directory"}');
        return send(200, TYPES[".html"], reportPage(name, await readFile(file, "utf8")));
      }
      if (url.pathname === "/history.json") {
        const raw = await readFile(join(outDir, ".portamp", "history.jsonl"), "utf8").catch(() => "");
        return send(200, TYPES[".json"], JSON.stringify(raw.split("\n").filter(Boolean).map((line) => JSON.parse(line))));
      }
      // The run before this one, kept one generation deep, so the console
      // can hold two runs side by side; "null" is a first run, not an error.
      if (url.pathname === "/run.previous.json") {
        const prev = await readFile(join(outDir, ".portamp", "run.previous.json"), "utf8").catch(() => null);
        return send(200, TYPES[".json"], prev ?? "null");
      }

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

      // The custom element target needs no build, which makes it the one
      // target the compare pane can render as pixels. Only files directly in
      // src/elements/ are served executable, under a path shaped URL so the
      // element's own relative imports (./runtime.js) resolve; /source stays
      // text/plain.
      const elementFile = /^\/elements\/([\w-]+(?:\.lit)?\.js)$/.exec(url.pathname);
      if (elementFile) {
        if (/\.lit\.js$/.test(elementFile[1])) {
          return send(403, TYPES[".json"], '{"error":"the lit element needs its dependency; preview uses the dependency free one"}');
        }
        const file = within(outDir, `src/elements/${elementFile[1]}`);
        if (!file) return send(403, TYPES[".json"], '{"error":"outside the output directory"}');
        return send(200, "text/javascript; charset=utf-8", await readFile(file, "utf8"));
      }

      if (url.pathname === "/preview") {
        const rel = decodeURIComponent(url.searchParams.get("path") ?? "");
        const file = within(outDir, rel);
        if (!file || !/^src\/elements\/[\w-]+\.js$/.test(rel)) {
          return send(403, TYPES[".json"], '{"error":"only emitted elements can be previewed"}');
        }
        const source = await readFile(file, "utf8");
        const tag = /customElements\.define\(\s*["']([\w-]+)["']/.exec(source)?.[1];
        if (!tag) return send(404, TYPES[".json"], '{"error":"the file defines no custom element"}');
        return send(200, TYPES[".html"], previewPage(tag, rel, url.searchParams.get("state") ?? "empty"));
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
      describe: "serve the last run on 127.0.0.1; drop an .exe, a screenshot or a folder on it to port that; --watch reruns on change",
      async run({ config, log, args, runPipeline }) {
        const runPath = join(config.out, ".portamp", "run.json");
        const already = await readFile(runPath, "utf8").then(() => true).catch(() => false);

        if (!already || args.fresh) {
          await runPipeline();
        } else {
          log.info("serving the last run. Pass --fresh to run the pipeline again.\n");
        }

        // A rerun from the console may point the run at the intake and switch an offered flag on. The core reads
        // the config when a run starts, so the command the config was handed to is what changes it, and the tree
        // and screenshots it was started with come back the moment a rerun asks for them.
        const intake = createIntake(join(config.out, ".portamp", "intake"));
        const original = { src: config.src, shots: config.shots };
        const rerun = async (options = {}) => {
          const { source, flags } = rerunOptions(options);
          config.src = source === "intake" ? intake.dir : original.src;
          config.shots = source === "intake" ? intake.dir : original.shots;
          for (const [flag, on] of Object.entries(flags)) config[flag] = on;
          return runPipeline();
        };
        const { server, address } = await serve({
          outDir: config.out,
          shotsDir: config.shots,
          port: Number(args.port) || 4321,
          log,
          rerun,
          intake,
        });
        if (!openBrowser(address)) log.info("could not open a browser, open that address yourself");

        // --watch closes the loop the console's poll already listens for:
        // a source edit reruns the pipeline, the run's timestamp moves, and
        // every open console refreshes itself. The same debounce and the
        // same one-at-a-time rule as the watch command.
        if (args.watch) {
          const { watch } = await import("node:fs");
          let running = false;
          let queued = false;
          let timer = null;
          const runOnce = async (what) => {
            if (running) { queued = true; return; }
            running = true;
            try {
              const ctx = await runPipeline();
              log.info(`${new Date().toLocaleTimeString()}  ${what}: ${ctx.written.length} file(s), ${ctx.report.unverified.length} unverified`);
            } catch (err) {
              log.error(`${what}: ${err.message}`);
            }
            running = false;
            if (queued) { queued = false; runOnce("queued change"); }
          };
          let changed = new Set();
          watch(config.src, { recursive: true }, (_event, filename) => {
            if (filename) changed.add(String(filename));
            clearTimeout(timer);
            timer = setTimeout(() => {
              const what = [...changed].slice(0, 3).join(", ") + (changed.size > 3 ? ` +${changed.size - 3}` : "");
              changed = new Set();
              runOnce(what || "changed");
            }, 200);
          });
          log.info(`watching ${config.src}; the console refreshes itself after each rerun`);
        }

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
      // A dry run leaves no trace on disk, this sidecar included.
      if (ctx.config.dryRun) return log.debug("dry run; run.json not written");
      await mkdir(dirname(target), { recursive: true });
      // The previous run survives one generation, so the console can put two
      // runs side by side: what changed, what got worse, which notes closed.
      const previous = await readFile(target, "utf8").catch(() => null);
      if (previous !== null) {
        await writeFile(join(ctx.config.out, ".portamp", "run.previous.json"), previous, "utf8");
      }
      await writeFile(target, JSON.stringify(run, null, 2) + "\n", "utf8");
      log.info(
        `run.json written, ${run.plugins.length} plugin(s), ${run.screens.length} screen(s), ` +
          `${run.unverified.length} unverified`
      );
    });
  },
};
