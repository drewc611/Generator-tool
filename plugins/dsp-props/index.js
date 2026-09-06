import { pascal } from "../dsp-ir/emit.js";
import { blockFragments } from "../dsp-components/index.js";

/**
 * The shared component learns what varies.
 *
 * dsp-components lifts a block that recurs byte for byte. The more common
 * repeat is not byte identical: two cards, two rows, two panels with the same
 * structure and different words. Those are one component with a prop for each
 * thing that differs, and naming that prop is the judgment the tool defers to
 * a person rather than guessing.
 *
 * This finds the structural twins: block fragments that share a skeleton, the
 * markup with its text and attribute values blanked out. Where the skeleton
 * matches across two or more screens but the blanked slots do not, the slots
 * that differ are the props a shared component would take. It proposes them,
 * with the values it actually observed, and never lifts: parameterizing a
 * screen is a decision about what is allowed to vary, which is the product's
 * to make, not the porter's.
 */

// A slot marker that cannot occur in markup, so the skeleton join is
// unambiguous no matter what the template held.
const SLOT = "¤";

const collapse = (s) => s.replace(/\s+/g, " ").trim();

/**
 * A fragment split into its skeleton (structure only, every variable value
 * replaced by a marker) and its slots (those values in document order). Two
 * fragments with the same skeleton are the same shape; comparing their slots
 * says which parts of that shape actually vary.
 */
export function decompose(html) {
  const skeleton = [];
  const slots = [];
  // The catch all branch excludes quotes so it cannot also match a character
  // the quoted branches match; that overlap is what makes the scan backtrack
  // exponentially on a tag full of quote characters.
  const tag = /<\/?[a-z][\w-]*(?:"[^"]*"|'[^']*'|[^>"'])*?>/gi;
  let last = 0;
  let m;
  const pushText = (raw) => {
    const value = collapse(raw);
    if (!value) return;
    skeleton.push(SLOT);
    slots.push({ kind: "text", value });
  };
  while ((m = tag.exec(html))) {
    pushText(html.slice(last, m.index));
    last = tag.lastIndex;
    const source = m[0];
    if (/^<\//.test(source)) {
      skeleton.push(source.replace(/\s+/g, "").toLowerCase());
      continue;
    }
    const name = /^<([a-z][\w-]*)/i.exec(source)[1].toLowerCase();
    skeleton.push(`<${name}`);
    // Attribute names are structure and stay in the skeleton; a name with a
    // value contributes one slot, sorted by name so two orderings of the same
    // attributes read as the same shape.
    // Quotes are excluded from the name class so a value's opening quote can
    // never also start a name: that ambiguity is what makes an attribute regex
    // backtrack exponentially on a run of quote characters.
    const attrs = [...source.matchAll(/([^\s=/<>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)]
      .filter((a) => a[1] && a[1] !== "/")
      .map((a) => ({
        name: a[1].toLowerCase(),
        value: a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : null,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const a of attrs) {
      if (a.value === null) {
        skeleton.push(a.name);
      } else {
        skeleton.push(`${a.name}=`, SLOT);
        slots.push({ kind: "attr", name: a.name, value: a.value });
      }
    }
    skeleton.push(">");
  }
  pushText(html.slice(last));
  return { skeleton: skeleton.join("|"), slots };
}

/** A component name from the shape's own words when it has any, else its rank. */
function nameFor(html, index) {
  const heading = /<h[1-6][^>]*>([^<]{2,40})</i.exec(html)?.[1]
    ?? /class\s*=\s*["']([\w-]+)/i.exec(html)?.[1]
    ?? null;
  const slug = heading ? heading.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") : "";
  return slug ? `Port${pascal(slug)}` : `PortShape${index + 1}`;
}

/** A prop name from the attribute it fills, or the words around a text slot. */
function propName(slot, values, index) {
  if (slot.kind === "attr") {
    const base = slot.name.replace(/^(data-|aria-)/, "").replace(/[^\w]+/g, "-");
    return pascal(base).replace(/^./, (c) => c.toLowerCase()) || `prop${index + 1}`;
  }
  // A text slot's best name is a short, shared word from the values, if the
  // copies happen to agree on one; otherwise it is positional.
  const word = values.map((v) => v.match(/[a-z]{3,}/i)?.[0]).find(Boolean);
  return word ? word.toLowerCase() : `text${index + 1}`;
}

/**
 * The structural twins across screens: same skeleton, differing slots. A group
 * whose slots never differ is an exact repeat and belongs to dsp-components,
 * so it is dropped here. Nesting is collapsed to the largest shape, the same
 * way, so a card and its inner heading are not both proposed.
 */
export function findVariants(screens) {
  const groups = new Map();
  for (const screen of screens) {
    if (!screen.template) continue;
    for (const frag of blockFragments(screen.template)) {
      if (frag.html.length < 60) continue;
      const { skeleton, slots } = decompose(frag.html);
      if (!slots.length) continue;
      if (!groups.has(skeleton)) groups.set(skeleton, { skeleton, occ: [], screens: new Set() });
      const g = groups.get(skeleton);
      g.occ.push({ screen: screen.selector, start: frag.start, end: frag.end, html: frag.html, slots });
      g.screens.add(screen.selector);
    }
  }

  const candidates = [...groups.values()]
    .filter((g) => g.screens.size >= 2)
    .map((g) => {
      const width = g.occ[0].slots.length;
      const varying = [];
      for (let i = 0; i < width; i += 1) {
        const first = g.occ[0].slots[i]?.value;
        if (g.occ.some((o) => o.slots[i]?.value !== first)) varying.push(i);
      }
      return { ...g, varying };
    })
    // A shape whose every slot agrees is a byte identical repeat, not a
    // parameterized one. Leave it to dsp-components.
    .filter((g) => g.varying.length > 0)
    .sort((a, b) => b.skeleton.length - a.skeleton.length || (a.skeleton < b.skeleton ? -1 : 1));

  const kept = [];
  for (const g of candidates) {
    const nested = g.occ.every((o) =>
      kept.some((k) => k.occ.some((ko) => ko.screen === o.screen && ko.start <= o.start && o.end <= ko.end)));
    if (!nested) kept.push(g);
  }
  return kept;
}

/** Turn a kept group into a named proposal with a prop per varying slot. */
export function proposalsFrom(variants) {
  const taken = new Set();
  return variants.map((g, index) => {
    let name = nameFor(g.occ[0].html, index);
    while (taken.has(name)) name = `${name}_${index}`;
    taken.add(name);
    const usedProps = new Set();
    const props = g.varying.map((i, n) => {
      const slot = g.occ[0].slots[i];
      const values = g.occ.map((o) => o.slots[i]?.value).filter((v) => v != null);
      let prop = propName(slot, values, n);
      while (usedProps.has(prop)) prop = `${prop}${n + 1}`;
      usedProps.add(prop);
      return { prop, kind: slot.kind, on: slot.name ?? null, values: [...new Set(values)] };
    });
    return { name, screens: [...g.screens].sort(), size: g.occ[0].html.length, count: g.occ.length, props };
  });
}

export default {
  name: "dsp-props",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", (ctx) => {
      const screens = ctx.screens.filter((s) => s.template && s.readBy !== "components");
      if (screens.length < 2) return log.debug("fewer than two screens; nothing can vary");

      const variants = findVariants(screens);
      const proposals = proposalsFrom(variants);
      ctx.propsLibrary = proposals;
      if (!proposals.length) return log.debug("no structural twins across screens");

      log.info(`${proposals.length} parameterized component(s) proposed, ${proposals.reduce((n, p) => n + p.props.length, 0)} prop(s) named`);
      ctx.unverified(
        `PROPS.md proposes ${proposals.length} parameterized component(s): blocks that share a shape across screens but differ in content. ` +
        `The differing slots are named as props with the values observed. Nothing was lifted; deciding what is allowed to vary is a product call.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.propsLibrary) return;
      await ctx.write("PROPS.md", render(ctx.propsLibrary));
    });
  },
};

function render(proposals) {
  const head = `# Parameterized component proposals

A block that repeats byte for byte is lifted by dsp-components. These repeat
in *shape* but not in content: the same structure, different words. Each is
one component with a prop for every slot that changed between the copies.

They are proposed, not lifted. Which slots are allowed to vary, and what to
call them, is a decision about the product. The names below are a starting
point drawn from the attribute or the copy; rename them and portamp can be
pointed at the result.
`;
  if (!proposals.length) return head + "\nNo two screens shared a shape that varied. Nothing to parameterize.\n";

  const sections = proposals.map((p) => {
    const rows = p.props.map((prop) => {
      const sample = prop.values.slice(0, 3).map((v) => `\`${collapse(v).slice(0, 30)}\``).join(", ");
      const where = prop.kind === "attr" ? `\`${prop.on}\` attribute` : "text";
      return `| \`${prop.prop}\` | ${where} | ${sample}${prop.values.length > 3 ? ", …" : ""} |`;
    });
    return `### ${p.name}

Seen ${p.count} time(s) across ${p.screens.map((s) => `\`${s}\``).join(", ")} (${p.size} chars).

| prop | fills | values observed |
| --- | --- | --- |
${rows.join("\n")}`;
  });

  return `${head}
${sections.join("\n\n")}

---

Nothing here was written. Agree with a proposal by naming its props, and the
shape becomes a component with an owner, which is what a repeat that varies
never had.
`;
}
