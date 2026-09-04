import { translate } from "../output-react/template.js";
import { pascal, unique } from "../dsp-ir/emit.js";

/**
 * The Preact target. The JSX is the same JSX the React printer proves against
 * the other targets; what changes is the runtime: hooks come from
 * preact/hooks, no React import exists, and the bundle is a tenth the size,
 * which for a ported legacy tool is often the whole argument.
 */



export default {
  name: "output-preact",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.preact) return log.debug("not requested");

      const components = new Map(ctx.screens.map((s) => [s.selector.toLowerCase(), { name: pascal(s.selector) || "Screen" }]));
      let emitted = 0;
      for (const screen of ctx.screens) {
        const Name = pascal(screen.selector) || "Screen";
        const scoped = new Map(components);
        scoped.delete(screen.selector.toLowerCase());
        const result = screen.template ? translate(screen.template, { indent: 3, components: scoped }) : null;
        const collection = result?.collections[0] ?? "data";
        const props = unique([...screen.inputs, ...(result?.reads ?? []), "loading", "error", "onRetry"]);
        const referenced = (result?.components ?? []).map((sel) => components.get(sel).name);
        await ctx.write(`src/preact/${Name}/${Name}.jsx`, COMPONENT({ Name, props, screen, result, collection, referenced }));
        emitted += 1;
      }
      log.info(`${emitted} preact component(s)`);
    });
  },
};

const COMPONENT = ({ Name, props, screen, result, collection, referenced }) => {
  const models = result?.models ?? [];
  const state = models
    .map((m) => {
      const leaf = m.split(".").pop().replace(/[^\w$]/g, "");
      return `  const [${leaf}, set${leaf.charAt(0).toUpperCase()}${leaf.slice(1)}] = useState("");`;
    })
    .join("\n");
  const empty = collection === "data"
    ? "!data || (Array.isArray(data) && data.length === 0)"
    : `!${collection} || ${collection}.length === 0`;
  const imports = referenced.map((name) => `import ${name} from "../${name}/${name}.jsx";`).join("\n");

  return `${models.length ? 'import { useState } from "preact/hooks";\n' : ""}import { tokens as T } from "../../tokens.js";
${imports ? imports + "\n" : ""}
/**
 * Ported from ${screen.file} by portamp. Preact target: same JSX as the React
 * component, hooks from preact/hooks, no other runtime.
 *
 * Every state below is present on purpose. Delete one only when you have
 * checked the legacy screen genuinely cannot reach it.
 */
export default function ${Name}({ ${props.join(", ")} }) {
${state ? state + "\n" : ""}  if (loading) return <div role="status" style={{ padding: T.space[4], color: T.color.inkMuted }}>Loading…</div>;

  if (error)
    return (
      <div role="alert" style={{ padding: T.space[4] }}>
        <div style={{ fontWeight: T.weight.bold }}>Could not load</div>
        <div style={{ color: T.color.inkMuted, fontSize: T.size.sm }}>{String(error.message ?? error)}</div>
        <button onClick={onRetry} style={{ marginTop: T.space[2] }}>Try again</button>
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
${result?.jsx ?? `      {/* No template was found. Port the body from ${screen.file}. */}`}
    </div>
  );
}
`;
};
