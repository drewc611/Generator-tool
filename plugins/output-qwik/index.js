import { translate } from "../output-react/template.js";
import { pascal, unique } from "../dsp-ir/emit.js";

/**
 * The Qwik target. The body is the same JSX the React printer proves against
 * the other targets, because Qwik renders JSX; what Qwik changes is two things
 * this printer has to respect or the output does not run. Every handler prop
 * carries the `$` the optimizer needs to split it out, and local state is a
 * signal read through `.value` rather than a hook returning a pair. Both are
 * mechanical rewrites over the proven JSX, so nothing upstream learned Qwik.
 *
 *   qwik: true
 */

/** React handler props become Qwik's `$` suffixed props: onClick -> onClick$. */
const suffixHandlers = (jsx) => jsx.replace(/\bon([A-Z][A-Za-z]+)=\{/g, "on$1$$={");

/** A model read `{leaf}` or `={leaf}` becomes the signal read `{leaf.value}`. */
function readThroughValue(jsx, leaves) {
  let out = jsx;
  for (const leaf of leaves) {
    out = out.replace(new RegExp(`([={])(${leaf})\\}`, "g"), "$1$2.value}");
  }
  return out;
}

const leafOf = (model) => model.split(".").pop().replace(/[^\w$]/g, "");

export default {
  name: "output-qwik",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.qwik) return log.debug("not requested");

      const components = new Map(ctx.screens.map((s) => [s.selector.toLowerCase(), { name: pascal(s.selector) || "Screen" }]));
      let emitted = 0;
      for (const screen of ctx.screens) {
        const Name = pascal(screen.selector) || "Screen";
        const scoped = new Map(components);
        scoped.delete(screen.selector.toLowerCase());
        const result = screen.template ? translate(screen.template, { indent: 3, components: scoped }) : null;

        const models = result?.models ?? [];
        const leaves = unique(models.map(leafOf));
        let body = result?.jsx ?? null;
        if (body) body = readThroughValue(suffixHandlers(body), leaves);

        const collection = result?.collections[0] ?? "data";
        const props = unique([
          ...screen.inputs,
          ...screen.outputs.map((o) => `on${pascal(o)}`),
          ...(result?.reads ?? []),
          "loading", "error", "onRetry",
        ]);
        const referenced = (result?.components ?? []).map((sel) => components.get(sel).name);

        await ctx.write(`src/qwik/${Name}/${Name}.jsx`, COMPONENT({ Name, props, leaves, body, collection, screen, referenced: unique(referenced) }));
        emitted += 1;
      }
      log.info(`${emitted} qwik component(s)`);
    });
  },
};

const COMPONENT = ({ Name, props, leaves, body, collection, screen, referenced }) => {
  // A signal per model, and a plain local setter the handlers call. The setter
  // is captured by the component closure, so it needs no $ of its own.
  const signals = leaves
    .map((leaf) => `  const ${leaf} = useSignal("");\n  const set${leaf.charAt(0).toUpperCase()}${leaf.slice(1)} = (v) => { ${leaf}.value = v; };`)
    .join("\n");

  const empty = collection === "data"
    ? "!data || (Array.isArray(data) && data.length === 0)"
    : `!${collection} || ${collection}.length === 0`;
  const imports = referenced.map((name) => `import { ${name} } from "../${name}/${name}.jsx";`).join("\n");

  return `import { component$, useSignal } from "@builder.io/qwik";
import { tokens as T } from "../../tokens.js";
${imports ? imports + "\n" : ""}
/**
 * Ported from ${screen.file} by portamp. Qwik target: the proven JSX, handlers
 * split with $, and local state as signals read through .value.
 *
 * Every state below is present on purpose. Delete one only when you have
 * checked the legacy screen genuinely cannot reach it.
 */
export const ${Name} = component$((props) => {
  const { ${props.join(", ")} } = props;
${signals ? signals + "\n" : ""}
  if (loading) return <div role="status" style={{ padding: T.space[4], color: T.color.inkMuted }}>Loading…</div>;

  if (error)
    return (
      <div role="alert" style={{ padding: T.space[4] }}>
        <div style={{ fontWeight: T.weight.bold }}>Could not load</div>
        <div style={{ color: T.color.inkMuted, fontSize: T.size.sm }}>{String(error.message ?? error)}</div>
        <button onClick$={onRetry} style={{ marginTop: T.space[2] }}>Try again</button>
      </div>
    );

  if (${empty})
    return (
      <div style={{ padding: T.space[5], textAlign: "center", color: T.color.inkMuted }}>
        Nothing to show yet.
      </div>
    );

  return (
    <div style={{ padding: T.space[3], color: T.color.ink, background: T.color.surface }}>
${body ?? `      {/* No template was found. Port the body from ${screen.file}. */}`}
    </div>
  );
});
`;
};
