import { splitCommas } from "../dsp-ir/text.js";
import { unique } from "../dsp-ir/emit.js";

/**
 * Reads Sybase/Appeon PowerBuilder's exported `.srw` window source files, the
 * plain text an IDE's "Export Object" (or a version control integration)
 * writes for a Window object. The grammar is PowerBuilder's own, line
 * oriented and keyword driven rather than braced or tagged: a `forward`
 * section declares every control's name and PowerBuilder class up front, so
 * this scanner reads that section for names and classes only and never for
 * values. A control's real properties live in a second, later `type <name>
 * from <class> within <window> ... end type` block that is not nested inside
 * `forward`; this is the one the lowering reads, and finding it rather than
 * the forward-declared shell is the one structural decision this file makes.
 * `event <control>::<event>; ... end event` blocks carry PowerScript, kept
 * only as existing and how many lines they run, the same restraint
 * input-vb6 and input-swing already keep over code a GUI builder did not
 * write.
 *
 * The scanner walks lines with a small block stack; it never runs a regular
 * expression over the whole file, because a control's `text` or a window's
 * `title` string literal can spell anything the grammar's own keywords spell.
 */

const OPENERS = [
  { re: /^forward$/i, kind: "forward", closer: /^end\s+forward$/i },
  { re: /^global\s+type\s+(\S+)\s+from\s+window$/i, kind: "globaltype", closer: /^end\s+type$/i },
  { re: /^type\s+variables$/i, kind: "variables", closer: /^end\s+variables$/i },
  { re: /^type\s+(\S+)\s+from\s+(\S+?)(?:\s+within\s+(\S+))?$/i, kind: "type", closer: /^end\s+type$/i },
  { re: /^on\s+(\S+)\.(\w+)$/i, kind: "on", closer: /^end\s+on$/i },
  { re: /^event\s+(\S+)::(\w+)\s*;?$/i, kind: "event", closer: /^end\s+event$/i },
];

/** A line without a trailing `//` comment, a doubled `""` inside a string read as one literal quote rather than the
 * string's own close, the same shape input-vb6's `uncomment` already reads for VB6's `'` comment instead. */
function uncomment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inString && line[i + 1] === '"') { i += 1; continue; }
      inString = !inString;
    } else if (!inString && c === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

/** `uncomment`'s line with every string's own content emptied too, so a boundary keyword ("end type", an opener)
 * is only ever recognised outside one, never inside a caption or title that happens to spell it. */
function cleaned(line) {
  let out = "";
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inString) {
      if (c === '"') { if (line[i + 1] === '"') { i += 1; continue; } inString = false; }
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "/" && line[i + 1] === "/") break;
    out += c;
  }
  return out.trim();
}

function openerFor(line) {
  for (const o of OPENERS) { const m = o.re.exec(line); if (m) return { kind: o.kind, closer: o.closer, m }; }
  return null;
}

/**
 * One PowerBuilder string literal decoded: double quoted, a doubled `""`
 * standing for one literal quote, or null when the text is not one whole
 * literal. Not input-vb6's `parseValue`: that function also resolves VB6's
 * own `.frx` binary companion pointer syntax (`"name.frx":0000`), which a
 * `.srw` export has no equivalent of, and importing it would tie this
 * reader to a shape it never produces.
 */
export function parseString(raw) {
  const s = String(raw ?? "").trim();
  const m = /^"((?:[^"]|"")*)"$/.exec(s);
  if (!m) return null;
  return m[1].replace(/""/g, '"');
}

function parseArrayItem(token) {
  const t = token.trim();
  const s = parseString(t);
  if (s !== null) return s;
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  if (/^(true|false)$/i.test(t)) return /^true$/i.test(t);
  return t;
}

/** PowerBuilder's own array literal, `{item, item, ...}`, split at its top level commas the shared `splitCommas`
 * already reads for every other dialect, and each item decoded on its own. Null when the text is not one whole
 * brace pair. */
export function parseArrayLiteral(text) {
  const m = /^\{([\s\S]*)\}$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const inner = m[1].trim();
  return inner ? splitCommas(inner, { ticks: false }).map(parseArrayItem) : [];
}

const PROP = /^(\S+)\s+([A-Za-z_]\w*)(\[\])?\s*=\s*([\s\S]*)$/;

/** The `type = value` property lines a control or window block's own body holds, keyed by property name. Only
 * `integer`, `string` and `boolean` are read for a real value; anything else (`long`, a custom enum member, a
 * font or colour property) is kept as an opaque entry, its type noted and its value never read, the way
 * input-qt's and input-glade's own opaque properties are never read either. */
function readProperties(body) {
  const props = {};
  for (const { raw } of body) {
    const line = uncomment(raw).trim();
    if (!line) continue;
    const m = PROP.exec(line);
    if (!m) continue; // a bare "name name" declaration-order line, or stray text; not a property
    const [, type, name, arrMark, valueRaw] = m;
    if (arrMark) {
      props[name] = { type, array: true, items: parseArrayLiteral(valueRaw) ?? [] };
    } else if (/^string$/i.test(type)) {
      props[name] = { type, value: parseString(valueRaw.trim()) ?? "" };
    } else if (/^boolean$/i.test(type)) {
      props[name] = { type, value: /^true$/i.test(valueRaw.trim()) };
    } else if (/^integer$/i.test(type)) {
      const num = Number(valueRaw.trim());
      props[name] = { type, value: Number.isFinite(num) ? num : null };
    } else {
      props[name] = { type, opaque: true };
    }
  }
  return props;
}

/** The window's own `<name> <name>` declaration lines, in file order and deduplicated: the layout order a screen's
 * controls render in, since PowerBuilder does not guarantee the later `type` blocks come in visual order. */
function readOrder(body) {
  const order = [];
  for (const { raw } of body) {
    const line = uncomment(raw).trim();
    const m = /^([A-Za-z_]\w*)\s+\1$/.exec(line);
    if (m) order.push(m[1]);
  }
  return unique(order);
}

/**
 * The whole `.srw` file read structurally: the export header's own name, the
 * forward section's declared name/class pairs, the window's own container
 * (its properties and its declaration order), a map of every control's real,
 * non-forward property block, and every `event X::Y; ... end event` block
 * found anywhere, each kept only as existing and how many lines it runs.
 */
export function readSrw(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const problems = [];
  let header = null;
  const forward = [];
  let windowBlock = null;
  const controls = new Map();
  const events = [];
  const stack = [];

  const finish = (frame, parent) => {
    if (frame.kind === "forward" || frame.kind === "variables" || frame.kind === "on") return;
    if (frame.kind === "event") {
      events.push({ control: frame.m[1], event: frame.m[2], startLine: frame.startLine, lines: frame.body.length });
      return;
    }
    // globaltype or type: a pair nested inside forward is a declaration only; the same pair outside it is real.
    const insideForward = parent?.kind === "forward";
    if (frame.kind === "globaltype") {
      const name = frame.m[1];
      if (insideForward) { forward.push({ name, class: "window", within: null }); return; }
      windowBlock = { name, class: "window", properties: readProperties(frame.body), order: readOrder(frame.body), startLine: frame.startLine };
      return;
    }
    const [, name, klass, within] = frame.m;
    if (insideForward) { forward.push({ name, class: klass, within: within || null }); return; }
    controls.set(name, { name, class: klass, within: within || null, properties: readProperties(frame.body), startLine: frame.startLine });
  };

  for (let n = 0; n < lines.length; n += 1) {
    const raw = lines[n];
    const line = cleaned(raw);
    if (!line) continue;
    if (n === 0) {
      const h = /^\$PBExportHeader\$(.+)$/i.exec(line);
      if (h) { header = h[1].trim(); continue; }
    }

    if (stack.length) {
      const top = stack[stack.length - 1];
      if (top.closer.test(line)) { stack.pop(); finish(top, stack[stack.length - 1] ?? null); continue; }
      if (top.kind === "forward") {
        // Only `forward` nests another opener; every other block's own body is just lines until its closer.
        const opener = openerFor(line);
        if (opener) { stack.push({ ...opener, body: [], startLine: n + 1 }); continue; }
        continue; // stray text directly inside forward, never a real type block
      }
      top.body.push({ raw, n });
      continue;
    }

    const opener = openerFor(line);
    if (opener) { stack.push({ ...opener, body: [], startLine: n + 1 }); continue; }
    // A bare "global <Name> <Name>" instance line, or noise between blocks: neither is read further.
  }
  if (stack.length) problems.push(`the block opened at line ${stack[stack.length - 1].startLine} is never closed`);

  return { header, forward, window: windowBlock, controls, events, problems };
}
