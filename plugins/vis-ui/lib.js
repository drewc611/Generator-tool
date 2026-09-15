/**
 * The console's pure half. Everything here takes values and returns values,
 * because logic that lives inside an event handler can only be tested by a
 * browser, and the enforcement this repo runs on is node --test. The page
 * loads this as a module and the suite imports the same file.
 */

/** The selection as a hash, so a screen and a stage filter survive a reload
 * and travel in a pasted link. Empty state is an empty string, not "#". */
export function encodeHash({ screen = null, stage = null } = {}) {
  const parts = [];
  if (screen) parts.push(`screen=${encodeURIComponent(screen)}`);
  if (stage) parts.push(`stage=${encodeURIComponent(stage)}`);
  return parts.length ? `#${parts.join("&")}` : "";
}

export function decodeHash(hash) {
  const params = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  return {
    screen: params.get("screen") || null,
    stage: params.get("stage") || null,
  };
}

/** One filter for every list panel: case blind, matched against the named
 * keys, and an empty query keeps everything. */
export function filterByQuery(items, query, keys) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => keys.some((key) => String(item[key] ?? "").toLowerCase().includes(q)));
}

/** Endpoints filter twice: free text over path, and a verb facet. */
export function filterEndpoints(endpoints, query, verb) {
  const byText = filterByQuery(endpoints, query, ["path", "method"]);
  return verb ? byText.filter((e) => e.method === verb) : byText;
}

/**
 * The rack's two orders: "class" keeps the roster order it was given, "cost"
 * puts the expensive plugins first so a slow run names its suspect. The sort
 * is a copy; the run object is nobody's to reorder.
 */
export function sortPlugins(plugins, mode) {
  if (mode !== "cost") return plugins;
  return [...plugins].sort((a, b) => b.ms - a.ms);
}

/**
 * A polyline through the values, scaled into the box, oldest first. One value
 * draws a flat line, because a trend of one still deserves a mark; no values
 * draw nothing.
 */
export function sparklinePoints(values, width, height) {
  const list = (values ?? []).map(Number).filter(Number.isFinite);
  if (!list.length) return "";
  const max = Math.max(...list, 1);
  const min = Math.min(...list, 0);
  const span = max - min || 1;
  const step = list.length > 1 ? width / (list.length - 1) : 0;
  return list
    .map((v, i) => {
      const x = list.length > 1 ? i * step : width / 2;
      const y = height - ((v - min) / span) * (height - 2) - 1;
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(" ");
}

/** The stage each number key selects. One row of keys, five stages. */
export const STAGE_KEYS = { 1: "scan", 2: "extract", 3: "plan", 4: "emit", 5: "verify" };

/**
 * The whole keymap as one decision. Keys inside an input belong to the
 * input, so the caller says where the key landed and gets null back there;
 * everything else maps to a named action the page performs.
 */
export function keyAction(key, { inInput = false } = {}) {
  if (inInput) return null;
  if (key === "j" || key === "ArrowDown") return { kind: "next-screen" };
  if (key === "k" || key === "ArrowUp") return { kind: "prev-screen" };
  if (key === "/") return { kind: "focus-filter" };
  if (key === "f") return { kind: "focus-rack-filter" };
  if (key === "c") return { kind: "copy-diagnostics" };
  if (key === "?") return { kind: "toggle-help" };
  if (key === "r") return { kind: "rerun" };
  if (key === "t") return { kind: "toggle-theme" };
  if (key === "[") return { kind: "wipe", by: -5 };
  if (key === "]") return { kind: "wipe", by: 5 };
  if (STAGE_KEYS[key]) return { kind: "stage", stage: STAGE_KEYS[key] };
  if (key === "0") return { kind: "stage", stage: null };
  return null;
}

/** What the connectivity line says. The cached run is still the truth about
 * the run; what it cannot be is fresher than the wire. */
export function offlineNotice(online) {
  return online ? "" : "offline — showing the last run this browser saw";
}

/** Which written files the compare pane can show as text. */
export function isTextFile(path) {
  return /\.(jsx?|tsx?|vue|svelte|md|json|css|html?|yml|svg|mmd|txt)$/i.test(String(path ?? ""));
}

/** The run's markdown reports, in the order they were written. */
export function reportsIn(files) {
  return (files ?? []).filter((f) => /\.md$/i.test(f) && !f.includes("/"));
}

/**
 * A row's text split around a case blind query, for highlighting a match
 * rather than only proving one exists. An empty query is the whole text as
 * one unmatched span, so a caller never has to special case it.
 */
export function matchRanges(text, query) {
  const s = String(text ?? "");
  const q = String(query ?? "").trim();
  if (!q) return [{ text: s, hit: false }];
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return [{ text: s, hit: false }];
  const spans = [];
  if (i > 0) spans.push({ text: s.slice(0, i), hit: false });
  spans.push({ text: s.slice(i, i + q.length), hit: true });
  if (i + q.length < s.length) spans.push({ text: s.slice(i + q.length), hit: false });
  return spans;
}

/** A timestamp in words relative to now, falling back to a plain date once
 * the gap stops being a useful number of minutes or hours. */
export function relativeTime(iso, now = Date.now()) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(then).toLocaleString();
}

/** A count with thousands separators, fixed to one locale so the suite's
 * expectation never depends on where the test happens to run. */
export function formatCount(n) {
  return Number(n ?? 0).toLocaleString("en-US");
}

/** The plain text a person gets from "copy diagnostics": the numbers already
 * on screen, in one block a bug report can paste verbatim. */
export function diagnosticsText(run) {
  if (!run) return "";
  const ms = (run.plugins ?? []).reduce((t, p) => t + p.ms, 0);
  const lines = [
    `portamp diagnostics`,
    `ran: ${run.ranAt ?? "unknown"}`,
    `files: ${(run.files ?? []).length}`,
    `plugins: ${(run.plugins ?? []).length}`,
    `ms: ${ms}`,
    `unverified: ${(run.unverified ?? []).length}`,
    `ported: ${run.coverage ? run.coverage.ported + "%" : "unmeasured"}`,
  ];
  return lines.join("\n");
}

const api = {
  encodeHash, decodeHash, filterByQuery, filterEndpoints, sortPlugins,
  sparklinePoints, STAGE_KEYS, keyAction, offlineNotice, isTextFile, reportsIn,
  matchRanges, relativeTime, formatCount, diagnosticsText,
};
if (typeof window !== "undefined") window.portampLib = api;

/**
 * Two runs side by side: what moved, which way, and which notes closed. The
 * verdict is only ever spoken for unverified, because that is the one number
 * where a direction is a judgment; everything else just changed.
 */
export function compareRuns(current, previous) {
  if (!current || !previous) return null;
  const count = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);
  const metrics = ["screens", "endpoints", "unverified", "files"].map((name) => {
    const was = count(previous[name]);
    const is = count(current[name]);
    return {
      name, was, is,
      delta: is - was,
      verdict: name !== "unverified" ? (is === was ? "level" : "changed") : is > was ? "worse" : is < was ? "better" : "level",
    };
  });
  const wasNotes = Array.isArray(previous.unverified) ? previous.unverified : [];
  const isNotes = Array.isArray(current.unverified) ? current.unverified : [];
  return {
    metrics,
    notesClosed: wasNotes.filter((n) => !isNotes.includes(n)),
    notesOpened: isNotes.filter((n) => !wasNotes.includes(n)),
  };
}

/* ------------------------------------------------------------ the intake */

/** The flags the console offers a rerun; anything else in a request is dropped, never passed to the run. */
export const FLAG_GROUPS = [
  { label: "targets", flags: ["vue", "svelte", "lit", "html", "angular", "preact", "solid", "qwik", "astro", "alpine"] },
  { label: "meta-frameworks", flags: ["next", "remix", "nuxt", "sveltekit", "eleventy"] },
  { label: "site", flags: ["site", "export", "components", "photo"] },
  { label: "hosts", flags: ["dockerfile", "nginx", "caddy"] },
  { label: "deploy plans", flags: ["aws", "azure", "gcp", "cloudflare", "vercel", "netlify"] },
  { label: "api & docs", flags: ["openapi", "msw", "postman", "curl", "adr", "migration", "types"] },
  { label: "tests", flags: ["cypress", "playwright", "storybook", "fixtures"] },
  { label: "design", flags: ["tailwind", "design-tokens"] },
  { label: "transformer", flags: ["transformer", "train", "train-reverse", "train-sort", "train-math", "train-reverse-mh", "train-sort-mh"] },
  { label: "study", flags: ["study"] },
];

/** Every flag the console offers, flattened from the groups it shows them in. */
export const RERUN_FLAGS = FLAG_GROUPS.flatMap((g) => g.flags);

/**
 * What a rerun sets on the run's config: the source and screenshots it reads, and every offered flag, a pressed
 * key on top of what the command line said and the command line's own value back for every key not pressed.
 */
export function rerunPatch(original, intakeDir, { source, flags, dir = null }) {
  const patch = {
    src: source === "intake" ? (dir ? `${intakeDir}/${dir}` : intakeDir) : original.src,
    shots: source === "intake" ? intakeDir : original.shots,
  };
  for (const flag of RERUN_FLAGS) patch[flag] = Object.hasOwn(flags, flag) ? flags[flag] : original.flags[flag];
  return patch;
}

/** A rerun request reduced to what the console may ask: the source to read and the offered flags as booleans. */
export function rerunOptions(body) {
  const source = body?.source === "intake" ? "intake" : "src";
  const flags = {};
  for (const flag of RERUN_FLAGS) if (body?.flags && Object.hasOwn(body.flags, flag)) flags[flag] = Boolean(body.flags[flag]);
  // A folder inside the intake, a copied site's own, may be the source; it is held to the intake's path rule.
  const dir = source === "intake" && body?.dir ? intakePath(body.dir) : null;
  return { source, flags, dir };
}

/** A site address the intake may be asked to copy: http or https, nothing else, or null. */
export function siteUrl(raw) {
  try {
    const u = new URL(String(raw ?? "").trim());
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
}

/**
 * A path a dropped file may land at inside the intake: relative, forward slashed, no empty, dot or dot dot segment,
 * no control character, and short. Anything else is null and the upload is refused.
 */
export function intakePath(raw) {
  const clean = String(raw ?? "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!clean || clean.length > 512 || /[\u0000-\u001f\u007f]/.test(clean)) return null;
  const parts = clean.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return parts.join("/");
}
