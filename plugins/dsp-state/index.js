/**
 * A proposal for where state should live in the port, argued from what each
 * screen actually reads and writes. The rule is the boring one: state stays
 * local until a second screen needs it. Every promotion in this report names
 * the screens that force it, so the premise can be argued with.
 */

import { readFile } from "node:fs/promises";
import { translate } from "../output-react/template.js";
import { balanced } from "../dsp-ir/scan.js";

/**
 * The state that survives a reload: every localStorage and sessionStorage
 * key the scripts touch, and whether cookies are written by hand. A port
 * that renames a key silently logs everybody out or forgets every draft, so
 * the keys are a contract and this lists them. Key names only; no value is
 * ever read or reproduced here.
 */
export function persistedKeys(text, rel) {
  const found = [];
  for (const m of text.matchAll(/(localStorage|sessionStorage)\s*\.\s*(getItem|setItem|removeItem)\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    found.push({ store: m[1], op: m[2], key: m[3], file: rel });
  }
  for (const m of text.matchAll(/(localStorage|sessionStorage)\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g)) {
    found.push({ store: m[1], op: "indexed", key: m[2], file: rel });
  }
  if (/document\.cookie\s*=/.test(text)) found.push({ store: "cookie", op: "setItem", key: "(written by hand)", file: rel });
  return found;
}

/**
 * The stores the app declared: Vuex, Pinia and NgRx shapes read from source
 * as state evidence. What is read is what is written down: store names,
 * state keys, and the actions' own names. No reducer is executed and no
 * initial value is reproduced; the shape is the evidence, the values are
 * the app's.
 */
export function readStores(text, rel) {
  const found = [];
  // Top level keys of one object body: a name at brace or comma depth zero
  // followed by a colon. Nested bodies never reach here, because the body
  // was cut out with balanced braces first.
  const keysOf = (body) => {
    // Blank every nested (), [] and {} to spaces of the same length, so what
    // remains is only the top level, where a member is a name at the start
    // or after a comma followed by a colon (a key) or a paren (a method).
    let flat = String(body ?? "");
    let prev;
    // Collapse the innermost brackets to an empty pair, repeatedly, so a
    // value's own commas and colons never look like members but a method's
    // own `()` and a value's `{}`/`[]` still terminate their key.
    do {
      prev = flat;
      flat = flat.replace(/\([^()]*\)/g, "()").replace(/\{[^{}]*\}/g, "{}").replace(/\[[^\][]*\]/g, "[]");
    } while (flat !== prev);
    const keys = [];
    for (const m of flat.matchAll(/(?:^|,)\s*([\w$]+)\s*[:(]/g)) keys.push(m[1]);
    return [...new Set(keys)].filter((k) => k !== "state" && k !== "return");
  };
  // The object literal that follows a marker like `state:` or `mutations:`,
  // read with balanced braces so a nested `{}` cannot end it early.
  const blockAfter = (body, marker) => {
    const at = new RegExp(`\\b${marker}\\s*:\\s*(?:\\(\\s*\\)\\s*=>\\s*)?\\(?\\s*\\{`).exec(body);
    if (!at) return null;
    const open = body.indexOf("{", at.index);
    const block = balanced(body, open);
    return block ? block.slice(1, -1) : null;
  };
  const storeBody = (re) => {
    const out = [];
    for (const m of text.matchAll(re)) {
      const open = text.indexOf("{", m.index + m[0].length - 1);
      const block = balanced(text, open);
      if (block) out.push({ body: block.slice(1, -1), name: m[1] ?? null });
    }
    return out;
  };

  for (const { body } of storeBody(/(?:new\s+Vuex\.Store|createStore)\s*\(\s*\{/g)) {
    const state = blockAfter(body, "state");
    const mutations = blockAfter(body, "mutations");
    found.push({ kind: "vuex", name: null, stateKeys: state ? keysOf(state) : [], actions: mutations ? keysOf(mutations) : [], file: rel });
  }
  for (const { body, name } of storeBody(/defineStore\s*\(\s*['"`]([\w-]+)['"`]\s*,\s*\{/g)) {
    const state = blockAfter(body, "state");
    const actions = blockAfter(body, "actions");
    found.push({ kind: "pinia", name, stateKeys: state ? keysOf(state) : [], actions: actions ? keysOf(actions) : [], file: rel });
  }
  for (const m of text.matchAll(/createAction\s*\(\s*['"`]\[([^\]]+)\]\s*([^'"`]+)['"`]/g)) {
    const scope = m[1].trim();
    let store = found.find((s) => s.kind === "ngrx" && s.name === scope && s.file === rel);
    if (!store) {
      store = { kind: "ngrx", name: scope, stateKeys: [], actions: [], file: rel };
      found.push(store);
    }
    store.actions.push(m[2].trim());
  }
  if (/createReducer\s*\(/.test(text) && !found.some((s) => s.kind === "ngrx" && s.file === rel)) {
    found.push({ kind: "ngrx", name: null, stateKeys: [], actions: [], file: rel });
  }
  return found;
}

export default {
  name: "dsp-state",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const persisted = [];
      const stores = [];
      for (const file of ctx.sources.files.filter((f) => /\.(js|ts|vue|html?)$/.test(f.rel) && !/\.min\./.test(f.rel))) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        persisted.push(...persistedKeys(text, file.rel));
        stores.push(...readStores(text, file.rel));
      }
      if (stores.length) {
        ctx.stores = stores;
        ctx.unverified(
          `${stores.length} declared store shape(s) read from source (${[...new Set(stores.map((s) => s.kind))].join(", ")}). ` +
          "The state keys and action names are the app's own contract with itself; STATE.md lists them, and the port's state design should answer each one by name."
        );
        log.info(`${stores.length} store shape(s): ${[...new Set(stores.map((s) => s.kind))].join(", ")}`);
      }
      if (persisted.length) {
        const keys = new Map();
        for (const p of persisted) {
          const id = `${p.store}:${p.key}`;
          if (!keys.has(id)) keys.set(id, { ...p, ops: new Set(), files: new Set() });
          keys.get(id).ops.add(p.op);
          keys.get(id).files.add(p.file);
        }
        ctx.persistedState = [...keys.values()].map((k) => ({ ...k, ops: [...k.ops], files: [...k.files] }));
        ctx.unverified(
          `${ctx.persistedState.length} storage key(s) survive a reload (${ctx.persistedState.slice(0, 3).map((k) => `\`${k.key}\``).join(", ")}${ctx.persistedState.length > 3 ? ", …" : ""}). ` +
          `Users' browsers hold these under exactly these names; a port that renames one silently drops whatever it held. STATE.md lists them.`
        );
        log.info(`${ctx.persistedState.length} persisted key(s)`);
      }
      const screens = ctx.screens.filter((s) => s.template);
      if (!screens.length) return log.debug("no screens to read");

      const perScreen = [];
      for (const s of screens) {
        try {
          const result = translate(s.template, { indent: 0 });
          perScreen.push({ screen: s.selector, reads: result.reads, models: result.models, collections: result.collections });
        } catch {
          perScreen.push({ screen: s.selector, reads: [], models: [], collections: [], unreadable: true });
        }
      }

      const usedBy = new Map();
      for (const p of perScreen) {
        for (const name of new Set([...p.reads, ...p.collections.map((c) => c.split(".")[0])])) {
          usedBy.set(name, [...(usedBy.get(name) ?? []), p.screen]);
        }
      }

      const shared = [...usedBy.entries()].filter(([, screens]) => new Set(screens).size > 1);
      const local = [...usedBy.entries()].filter(([, screens]) => new Set(screens).size === 1);
      ctx.stateShape = { perScreen, shared, local };
      log.info(`${shared.length} shared name(s), ${local.length} local`);
    });

    on("emit", async (ctx) => {
      if (!ctx.stateShape && !ctx.persistedState && !ctx.stores) return;
      const { perScreen = [], shared = [], local = [] } = ctx.stateShape ?? {};
      const lines = [
        "# Where state should live",
        "",
        "Proposed from what each screen reads. The rule: local until a second",
        "screen needs it. A name two screens read is not proof they share the",
        "value, so every promotion below names its evidence.",
        "",
        "## Shared candidates",
        "",
      ];
      if (shared.length) {
        for (const [name, screens] of shared) {
          lines.push(`- \`${name}\`: read by ${[...new Set(screens)].map((s) => `\`${s}\``).join(" and ")}. Promote only if it is the same value on both; a coincidence of naming stays local twice.`);
        }
      } else {
        lines.push("- None. No name is read by more than one screen, so nothing earns a store.");
      }
      lines.push("", "## Local state, per screen", "");
      for (const p of perScreen) {
        const owned = [
          ...p.models.map((m) => `\`${m}\` (form state)`),
          ...local.filter(([, screens]) => screens.includes(p.screen)).map(([n]) => `\`${n}\``),
        ];
        lines.push(`- \`${p.screen}\`: ${owned.length ? owned.join(", ") : "nothing readable"}${p.unreadable ? " (template could not be read)" : ""}`);
      }
      if (ctx.persistedState?.length) {
        lines.push("", "## State that survives a reload", "");
        lines.push("Users' browsers hold these keys today, under exactly these names. Rename");
        lines.push("one and the port silently drops whatever it held: a session, a draft, a");
        lines.push("preference. Keep the name, or write the migration on first load.", "");
        lines.push("| store | key | operations seen | where |");
        lines.push("| --- | --- | --- | --- |");
        for (const k of ctx.persistedState) {
          lines.push(`| ${k.store} | \`${k.key}\` | ${k.ops.join(", ")} | ${k.files.join(", ")} |`);
        }
      }
      lines.push(
        "",
        "Loading, error and empty are per fetch and always local. Nothing in this",
        "report proposes a global store; with this few shared names, a prop or a",
        "URL parameter is usually the honest container.",
        ""
      );
      if (ctx.stores?.length) {
        lines.push("## The stores the app declared", "");
        lines.push("Read from source as shapes, never executed. Each row is a contract");
        lines.push("the app made with itself; the port's state design answers it by name.", "");
        lines.push("| kind | store | state keys | actions | file |");
        lines.push("| --- | --- | --- | --- | --- |");
        for (const store of ctx.stores) {
          lines.push(`| ${store.kind} | ${store.name ?? "(unnamed)"} | ${store.stateKeys.map((k) => `\`${k}\``).join(", ") || "unread"} | ${store.actions.map((a) => `\`${a}\``).join(", ") || "unread"} | ${store.file} |`);
        }
        lines.push("");
      }
      await ctx.write("STATE.md", lines.join("\n"));
    });
  },
};
