/**
 * Printing into a target language, safely.
 *
 * Every printer builds source code out of values it read from somebody else's
 * app, so the rules for putting a value into a string literal are the same for
 * all of them and they live here rather than four times over.
 *
 * `JSON.stringify` looks like it does this job and does not quite:
 *
 *   - It leaves `<` alone. A class name containing `</script>` ends the script
 *     element the moment anybody inlines the emitted module into a page, which
 *     turns a value in the old app into markup in the new one.
 *   - It leaves U+2028 and U+2029 as themselves. Since ES2019 they are legal
 *     inside a string literal, so a current engine parses them, but anything
 *     older treats them as line terminators and the literal ends early.
 */
export function jsString(value) {
  return JSON.stringify(value === undefined ? "" : String(value))
    .replace(/</g, "\\x3C")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * A value that has to be a name in the emitted code rather than a string.
 *
 * A selector is not required to be a legal identifier, and one that is not
 * produces a file that does not parse, so it is corrected here rather than
 * discovered by whoever runs the build.
 */
export function identifier(name, fallback = "Screen") {
  const cleaned = String(name ?? "").replace(/[^\w$]/g, "");
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : cleaned ? `_${cleaned}` : fallback;
}

/**
 * A single quoted string, for the targets that put an expression inside a
 * double quoted attribute. The backslash has to be escaped before the quote is,
 * or the escape the second pass adds is itself escaped by the first.
 */
export function singleQuoted(value) {
  return `'${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/</g, "\\x3C")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")}'`;
}

/** What each key modifier accepts. Vue's .delete takes both deleting keys. */
const GUARD_KEYS = {
  enter: ["Enter"], esc: ["Escape"], escape: ["Escape"], tab: ["Tab"], space: [" "],
  delete: ["Delete", "Backspace"], up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"],
};
const GUARD_BUTTONS = { left: 0, middle: 1, right: 2 };

/**
 * Event modifiers, for the targets whose handlers are plain functions. Each
 * modifier becomes the statement it stands for, guards first, so `.prevent`
 * and `.enter` survive the trip into a framework that has no dot syntax.
 * A modifier with no equivalent runs the handler unguarded and says so.
 */
export function guardHandler(name, handler, modifiers, note = () => {}) {
  const mods = modifiers ?? [];
  if (!mods.length) return handler;
  const guards = [];
  const effects = [];
  const keyish = /^key/.test(name);
  for (const mod of mods) {
    if (mod === "prevent") effects.push("event.preventDefault();");
    else if (mod === "stop") effects.push("event.stopPropagation();");
    else if (mod === "self") guards.push("if (event.target !== event.currentTarget) return;");
    else if (keyish && GUARD_KEYS[mod]) {
      guards.push(`if (${GUARD_KEYS[mod].map((k) => `event.key !== ${jsString(k)}`).join(" && ")}) return;`);
    } else if (!keyish && GUARD_BUTTONS[mod] !== undefined) {
      guards.push(`if (event.button !== ${GUARD_BUTTONS[mod]}) return;`);
    } else {
      note(`The \`.${mod}\` modifier on \`${name}\` has no equivalent in this target. The handler runs without it; re-apply the constraint by hand.`);
    }
  }
  if (!guards.length && !effects.length) return handler;
  return `{ ${[...guards, ...effects].join(" ")} ${handler}; }`;
}

/**
 * Text destined for the inside of a generated template literal. The backslash
 * goes first, or the escapes the later passes add are themselves escaped.
 */
export function templateText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\$\{")
}

/** kebab-or-snake to PascalCase, the one spelling of a component's name.
 * Shared here because twenty plugins each carrying their own copy is how
 * two of them end up disagreeing about what a screen is called. A name is
 * used as an identifier, and an identifier cannot open with a digit, so a
 * screen born from a path like 1996/index gets a P it can stand on. */
export const pascal = (sel) => {
  const out = String(sel ?? "").split(/[-_\s]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
  return /^\d/.test(out) ? `P${out}` : out;
};

/** Deduplicate and drop the holes, in first seen order. Four emitters each
 * carried this line; the shared spelling keeps them agreeing about it. */
export const unique = (list) => [...new Set(list.filter(Boolean))];

// The line a character index falls on. Seventeen analyzers asked this of the
// same file thousands of times each, rescanning from the top for every match;
// the newline table is built once per text and the answer is a binary search.
let lineText = null;
let lineBreaks = null;
export const lineAt = (text, index) => {
  if (text !== lineText) {
    lineText = text; lineBreaks = [];
    for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) lineBreaks.push(i);
  }
  let lo = 0; let hi = lineBreaks.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (lineBreaks[mid] < index) lo = mid + 1; else hi = mid; }
  return lo + 1;
};
