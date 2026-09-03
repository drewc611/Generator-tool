/**
 * Turns what the explorer saw into what the app is.
 *
 * Every function here is pure and takes the exploration document, so the whole
 * inference runs in a test with no browser. Nothing is inferred that the
 * document does not support: a rule the explorer never triggered is absent,
 * not assumed.
 */

const VALIDATION = /\b(required|must be|invalid|cannot be|too (short|long)|already (taken|exists)|please (enter|provide|choose)|not a valid)\b/i;

const LOADING = /\b(loading|please wait|fetching|working)\b/i;
const ERROR_TEXT = /\b(error|failed|unavailable|went wrong|try again|could not)\b/i;
const EMPTY_TEXT = /\b(no results|nothing (to show|here|found)|none found|empty|no [a-z]+ (yet|found))\b/i;

// The page text around a validation phrase, not the whole page. A message is a
// short sentence; the blob it was found in is everything else on screen. Found
// by locating the phrase and taking a few words either side, because a regular
// expression that can start anywhere will start at the top of the document.
const PHRASE = /\b(is required|are required|must be|must contain|cannot be|can not be|may not be|is invalid|is not valid|already exists|already taken|is too short|is too long|please enter|please provide|please choose)\b/i;

export function extractRule(message) {
  const text = String(message ?? "").replace(/\s+/g, " ").trim();
  const hit = PHRASE.exec(text);
  if (!hit) return text.slice(0, 80);
  // "is required" is a whole rule; "must be" is the start of one. Only the
  // open ones need the words that follow.
  const complete = /^(is|are) required$|^already (exists|taken)$|^is (not valid|invalid)$|^is too (short|long)$/i.test(hit[0]);
  const before = text.slice(0, hit.index).trim().split(" ").filter(Boolean).slice(-2);
  const after = complete ? [] : text.slice(hit.index + hit[0].length).trim().split(" ").filter(Boolean).slice(0, 3);
  const words = [...before, hit[0], ...after];
  // The label often sits immediately before the message that repeats it.
  return words.filter((w, i) => i === 0 || w.toLowerCase() !== words[i - 1].toLowerCase()).join(" ").trim();
}

/**
 * Two request paths that differ only in the last segment, across more than one
 * value, are one endpoint with a parameter. One example is a path; several are
 * a pattern.
 */
export function inferEndpoints(requests, { ignore = [] } = {}) {
  const byMethodPrefix = new Map();
  for (const r of requests) {
    if (!r.path || ignore.some((re) => re.test(r.path))) continue;
    const segments = r.path.split("/").filter(Boolean);
    const prefix = segments.slice(0, -1).join("/");
    const key = `${r.method} /${prefix}`;
    if (!byMethodPrefix.has(key)) byMethodPrefix.set(key, { method: r.method, prefix, leaves: new Map(), entries: [] });
    const group = byMethodPrefix.get(key);
    const leaf = segments[segments.length - 1] ?? "";
    group.leaves.set(leaf, (group.leaves.get(leaf) ?? 0) + 1);
    group.entries.push(r);
  }

  const endpoints = [];
  for (const group of byMethodPrefix.values()) {
    const leaves = [...group.leaves.keys()];
    const varying = leaves.length > 1 && leaves.every((l) => /\d/.test(l) || l.length > 6);
    if (varying) {
      endpoints.push(build(group, `/${group.prefix}/:id`, leaves));
    } else {
      for (const leaf of leaves) {
        const path = group.prefix ? `/${group.prefix}/${leaf}` : `/${leaf}`;
        endpoints.push(build(group, path, [], (r) => r.path === path));
      }
    }
  }
  return endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function build(group, path, examples, filter = () => true) {
  const entries = group.entries.filter(filter);
  const statuses = [...new Set(entries.map((e) => e.status).filter(Boolean))];
  const query = [...new Set(entries.flatMap((e) => e.query ?? []))];
  const withBody = entries.find((e) => e.body);
  return {
    method: group.method,
    path,
    params: path.includes(":id") ? ["id"] : [],
    query,
    statuses,
    observedBody: withBody ? safeJson(withBody.body) : null,
    examples: examples.slice(0, 3),
    observed: true,
  };
}

function safeJson(text) {
  try {
    const value = JSON.parse(text);
    // The shape is what a port needs. The values were somebody's test data.
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v]));
  } catch {
    return "not json";
  }
}

/** What kind of screen this is, judged only by what it showed. */
export function classifyScreen(screen) {
  const hasCollection = Boolean(screen.collection?.columns?.length);
  const inputs = (screen.elements ?? []).filter((e) => ["input", "textarea", "select"].includes(e.tag));
  const submits = (screen.elements ?? []).filter(
    (e) => e.tag === "button" && /\b(save|create|submit|add|update|send|apply)\b/i.test(e.name ?? "")
  );
  if (inputs.length && submits.length) return "form";
  if (hasCollection) return "list";
  return "detail";
}

/** Which of the four states this screen was actually seen in. */
export function observedStates(screenId, screens, steps) {
  const screen = screens.find((s) => s.id === screenId);
  const texts = [screen?.text ?? "", ...steps.filter((s) => s.to === screenId).flatMap((s) => s.messages)];
  const blob = texts.join(" ");
  return {
    loading: LOADING.test(blob),
    error: ERROR_TEXT.test(blob),
    empty: EMPTY_TEXT.test(blob) || screen?.collection?.rows === 0,
    body: Boolean(screen?.text?.trim()),
  };
}

/**
 * A field is required when submitting without it produced a message saying so.
 * That is a rule the app demonstrated, not one anybody guessed.
 */
export function inferFields(screen, steps) {
  const inputs = (screen.elements ?? []).filter((e) => ["input", "textarea", "select"].includes(e.tag));
  const messages = steps
    .filter((s) => s.from === screen.id)
    .flatMap((s) => s.messages)
    .filter((m) => VALIDATION.test(m));

  return inputs.map((input) => {
    const label = input.name || input.placeholder || input.id || "field";
    const rule = messages.find((m) => label && m.toLowerCase().includes(label.toLowerCase().split(" ")[0]));
    return {
      name: input.id || label,
      label,
      type: input.type ?? "text",
      labelled: input.labelled,
      placeholder: input.placeholder,
      required: Boolean(rule || input.required),
      validation: rule ? extractRule(rule) : null,
    };
  });
}


/**
 * A control labelled with the record it sits on is one control, not one per
 * row. The label is generalised so the model says "a row" rather than listing
 * somebody's customers back at them.
 */
export function actionLabel(step, screens) {
  const raw = (step.action.label || step.action.selector || "").trim();
  const selector = step.action.selector ?? "";
  const from = screens.find((s) => s.id === step.from);
  // The selector says what was clicked far more reliably than the text does.
  // A row inside a collection is addressed positionally; its label is whatever
  // record happened to be in it.
  const isRow = Boolean(from?.collection) && /\b(tr|li)\b|:nth-of-type/.test(selector);
  if (isRow) return "a row";
  return raw.replace(/\b[A-Za-z]{1,4}[-_]?\d{2,}\b/g, ":id").slice(0, 60);
}

/** A screen showing one record is not named after that record. */
export function generaliseName(text) {
  const cleaned = String(text ?? "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/\b[A-Za-z]{1,4}[-_]?\d{2,}\b/g, "")
    .replace(/\s*[-–—:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || String(text ?? "").trim();
}

export function buildModel(document) {
  const screens = document.screens ?? [];
  const steps = document.steps ?? [];

  const endpoints = inferEndpoints(document.requests ?? [], { ignore: [/^\/$/, /\.(html?|css|js|png|svg|ico|woff2?)$/i] });

  const modelled = screens.map((screen) => {
    const kind = classifyScreen(screen);
    return {
      id: screen.id,
      kind,
      name: generaliseName(screen.headings?.[0] || screen.regions?.find((r) => r !== "main") || screen.id),
      url: screen.url,
      collection: screen.collection ?? null,
      fields: kind === "form" ? inferFields(screen, steps) : [],
      states: observedStates(screen.id, screens, steps),
      actions: [...new Set(
        steps.filter((s) => s.from === screen.id).map((s) => actionLabel(s, screens)).filter(Boolean)
      )],
    };
  });

  const transitions = steps
    .filter((s) => s.changed)
    .map((s) => ({ from: s.from, to: s.to, via: actionLabel(s, screens) }))
    .filter((t, i, all) => all.findIndex((o) => o.from === t.from && o.to === t.to && o.via === t.via) === i);

  // Which request a screen fires is how a rebuild knows what to call.
  const wiring = [];
  for (const step of steps) {
    for (const request of step.requests ?? []) {
      const endpoint = endpoints.find(
        (e) => e.method === request.method && (e.path === request.path || (e.params.length && sameShape(e.path, request.path)))
      );
      if (!endpoint) continue;
      const entry = { screen: step.from, via: actionLabel(step, screens), endpoint: `${endpoint.method} ${endpoint.path}` };
      if (!wiring.some((w) => w.screen === entry.screen && w.via === entry.via && w.endpoint === entry.endpoint)) {
        wiring.push(entry);
      }
    }
  }

  return { baseUrl: document.baseUrl, screens: modelled, transitions, endpoints, wiring, skipped: document.skipped ?? [] };
}

function sameShape(pattern, path) {
  const a = pattern.split("/");
  const b = path.split("/");
  return a.length === b.length && a.every((seg, i) => seg.startsWith(":") || seg === b[i]);
}
