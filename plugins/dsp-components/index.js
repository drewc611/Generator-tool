import { pascal } from "../dsp-ir/emit.js";
import { VOID } from "../dsp-ir/parse.js";

/**
 * The port stops repeating itself.
 *
 * Every emitter writes one component per screen, so a block of markup that
 * three pages share becomes three copies of the same code. This finds those
 * repeats and, behind a flag, lifts each into one shared component the pages
 * compose from instead. It performs only the safe case — a block that recurs
 * byte for byte and carries no dynamic binding — and proposes the rest, the
 * same measure-then-perform contract the rest of the tool keeps.
 *
 * It is framework blind on purpose. The extraction adds a component screen to
 * the run and rewrites the pages to name it; every output target already
 * resolves a tag that names another screen to that component, so React, Vue,
 * Svelte and the custom element all pick up the shared component for free,
 * and nothing downstream learned a new idea.
 */

const BLOCK = new Set(["div", "section", "article", "aside", "header", "footer", "nav",
  "figure", "form", "ul", "ol", "table", "dl", "p", "fieldset", "details", "main"]);

// A fragment that binds, interpolates or handles is not a static block; it
// reads screen local state a shared component would not have. Proposed, never
// performed, because parameterizing it is a guess about what varies.
const DYNAMIC = /\{\{|\}\}|\*ng|\bng-|\bko-|\bdata-bind|\bv-[a-z]|\[[^\]]+\]\s*=|\([\w.:-]+\)\s*=|[:@][\w.-]+\s*=/;

/**
 * Every block level element in a template with its real extent, found by
 * counting the same tag's opens and closes so a nested div does not end its
 * parent early. Void elements never open a block; a tag that never closes is
 * skipped rather than swallowing the rest of the document.
 */
export function blockFragments(html) {
  const out = [];
  const open = /<([a-z][\w-]*)\b[^>]*?(\/?)>/gi;
  let m;
  while ((m = open.exec(html))) {
    const tag = m[1].toLowerCase();
    if (!BLOCK.has(tag) || m[2] === "/" || VOID.has(tag)) continue;
    const closer = new RegExp(`<${tag}\\b[^>]*?(\\/?)>|</${tag}\\s*>`, "gi");
    closer.lastIndex = m.index;
    let depth = 0;
    let end = -1;
    let c;
    while ((c = closer.exec(html))) {
      if (c[0][1] === "/") { depth -= 1; if (depth === 0) { end = closer.lastIndex; break; } }
      else if (c[1] !== "/") depth += 1;
    }
    if (end === -1) continue;
    out.push({ tag, start: m.index, end, html: html.slice(m.index, end) });
  }
  return out;
}

const normalize = (s) => s.replace(/\s+/g, " ").trim();

/**
 * The blocks that recur across two or more screens, grouped by their
 * normalized form, with every occurrence's real position kept so a rewrite
 * can find it again. Static and dynamic are separated: only static is safe
 * to perform.
 */
export function findRepeats(screens) {
  const groups = new Map();
  for (const screen of screens) {
    if (!screen.template) continue;
    for (const frag of blockFragments(screen.template)) {
      const key = normalize(frag.html);
      // Trivial blocks are noise: a bare <p>one line</p> shared by two pages
      // is not a component, it is a coincidence. The threshold keeps the
      // proposals to blocks a person would actually name.
      if (key.length < 60) continue;
      if (!groups.has(key)) groups.set(key, { key, occ: [], screens: new Set(), dynamic: DYNAMIC.test(frag.html) });
      groups.get(key).occ.push({ screen: screen.selector, start: frag.start, end: frag.end });
      groups.get(key).screens.add(screen.selector);
    }
  }
  const candidates = [...groups.values()]
    .filter((g) => g.screens.size >= 2)
    // Largest first, then the fragment itself, so the choice and the naming
    // are the same on every run over the same input.
    .sort((a, b) => b.key.length - a.key.length || (a.key < b.key ? -1 : 1));

  // A block that only ever appears inside a larger shared block is not an
  // independent component; the larger one already carries it. Drop it, so
  // the report proposes the whole card, not the card and its paragraph.
  const kept = [];
  for (const g of candidates) {
    const nested = g.occ.every((o) =>
      kept.some((k) => k.occ.some((ko) => ko.screen === o.screen && ko.start <= o.start && o.end <= ko.end)));
    if (!nested) kept.push(g);
  }
  return kept;
}

/** A component name from the block's own words when it has any, else its rank. */
function nameFor(key, index) {
  const heading = /<h[1-6][^>]*>([^<]{2,40})</i.exec(key)?.[1]
    ?? /class\s*=\s*["']([\w-]+)/i.exec(key)?.[1]
    ?? null;
  const slug = heading ? heading.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") : "";
  return slug ? `port-${slug}` : `port-block-${index + 1}`;
}

export default {
  name: "dsp-components",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", (ctx) => {
      const screens = ctx.screens.filter((s) => s.template && s.readBy !== "components");
      if (screens.length < 2) return log.debug("fewer than two screens; nothing can repeat");

      const repeats = findRepeats(screens);
      if (!repeats.length) return log.debug("no repeated blocks across screens");

      const performed = [];
      const proposed = [];
      const taken = new Set(ctx.screens.map((s) => s.selector.toLowerCase()));
      let index = 0;
      for (const group of repeats) {
        const dynamic = group.dynamic;
        let selector = nameFor(group.key, index);
        while (taken.has(selector.toLowerCase())) selector = `${selector}-${index}`;
        index += 1;
        (dynamic ? proposed : performed).push({ ...group, selector });
      }

      // The report is written whether or not the flag is set: knowing the
      // repeats exist is worth as much as removing them.
      ctx.componentLibrary = { performed, proposed };

      if (!(ctx.config.components ?? ctx.config.component)) {
        for (const c of performed) {
          ctx.unverified(`${c.screens.size} screens share a static block that could be one component (${c.selector}). Run with --components true to lift it, or see COMPONENTS.md.`);
        }
        log.info(`${performed.length} block(s) extractable, ${proposed.length} proposed only; --components performs the safe ones`);
        return;
      }

      // Perform: add each shared block as a component screen, then rewrite
      // every page that held it to name the component instead. Replacements
      // run from the end of each template so earlier indices stay valid, and
      // a region already replaced is never touched again.
      const byScreen = new Map(ctx.screens.map((s) => [s.selector, s]));
      const edits = new Map();
      for (const c of performed) {
        ctx.screens.push({
          selector: c.selector,
          className: pascal(c.selector),
          file: "components",
          inputs: [], outputs: [], rxjs: [],
          template: normalize(c.occ[0] ? byScreen.get(c.occ[0].screen).template.slice(c.occ[0].start, c.occ[0].end) : c.key),
          templateOrigin: `a shared block, extracted from ${c.screens.size} screens that repeated it`,
          usesNgIf: false, usesNgFor: false, usesTwoWay: false,
          readBy: "components",
          title: null,
        });
        for (const o of c.occ) {
          if (!edits.has(o.screen)) edits.set(o.screen, []);
          edits.get(o.screen).push({ start: o.start, end: o.end, tag: `<${c.selector}></${c.selector}>` });
        }
      }
      for (const [screen, list] of edits) {
        const target = byScreen.get(screen);
        if (!target) continue;
        // Non overlapping, end first. A later edit inside an earlier one is
        // dropped: the larger block already carried it away.
        const sorted = list.sort((a, b) => b.start - a.start);
        let lastStart = Infinity;
        for (const e of sorted) {
          if (e.end > lastStart) continue;
          target.template = target.template.slice(0, e.start) + e.tag + target.template.slice(e.end);
          lastStart = e.start;
        }
      }
      log.info(`${performed.length} shared component(s) extracted from repeated markup, ${proposed.length} proposed only`);
    });

    on("emit", async (ctx) => {
      if (!ctx.componentLibrary) return;
      const { performed, proposed } = ctx.componentLibrary;
      const active = ctx.config.components ?? ctx.config.component;
      const lines = [
        "# The shared component library",
        "",
        "Blocks of markup that more than one screen carried verbatim. A repeat",
        "is a component nobody drew; this is the list, and with `--components",
        "true` the static ones are drawn.",
        "",
      ];
      if (performed.length) {
        lines.push(active ? "## Extracted" : "## Extractable (run with --components true)", "");
        lines.push("| component | screens sharing it | size |", "| --- | --- | --- |");
        for (const c of performed) {
          lines.push(`| \`${pascal(c.selector)}\` | ${[...c.screens].map((s) => `\`${s}\``).join(", ")} | ${c.key.length} chars |`);
        }
        lines.push("");
      }
      if (proposed.length) {
        lines.push("## Proposed only", "");
        lines.push("These repeat too, but they bind or interpolate, so what varies");
        lines.push("between the copies would have to become a prop. Deciding what");
        lines.push("varies is a person's call, so they are named, not lifted:", "");
        for (const c of proposed) {
          lines.push(`- a block on ${[...c.screens].map((s) => `\`${s}\``).join(", ")} (${c.key.length} chars) carries dynamic content.`);
        }
        lines.push("");
      }
      if (!performed.length && !proposed.length) lines.push("No block recurs across screens. Nothing to share.", "");
      await ctx.write("COMPONENTS.md", lines.join("\n"));
    });
  },
};
