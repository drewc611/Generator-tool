const pascal = (sel) =>
  sel.split(/[-_]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

/**
 * Emits one React component per Angular component, plus a data hook where the
 * original talked to a service. Deliberately produces a skeleton with every
 * state present rather than a half filled body: an empty state that renders
 * nothing is the single most common thing a port forgets.
 */
export default {
  name: "output-react",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      for (const s of ctx.screens) {
        const Name = pascal(s.selector) || "Screen";
        const props = s.inputs.map((i) => `${i}`).concat(s.outputs.map((o) => `on${pascal(o)}`));
        const notes = [];
        if (s.usesTwoWay) notes.push(" * Two way binding in the original. Every input here is controlled.");
        if (s.rxjs.length) notes.push(` * RxJS in the original: ${s.rxjs.join(", ")}. Mapped to hooks, not ported one for one.`);
        await ctx.write(
          `src/features/${Name}/${Name}.jsx`,
          COMPONENT(Name, props, notes, s.file)
        );
      }
      log.info(`${ctx.screens.length} component(s) emitted`);
    });
  },
};

const COMPONENT = (Name, props, notes, origin) => `import React from "react";
import { tokens as T } from "../../tokens.js";

/**
 * Ported from ${origin}
${notes.length ? notes.join("\\n") : " *"}
 *
 * Every state below is present on purpose. Delete one only when you have
 * checked the legacy screen genuinely cannot reach it.
 */
export default function ${Name}({ ${props.join(", ")}${props.length ? ", " : ""}data, loading, error, onRetry }) {
  if (loading) return <div style={{ padding: T.space[4], color: T.color.inkMuted }}>Loading…</div>;

  if (error)
    return (
      <div style={{ padding: T.space[4] }}>
        <div style={{ fontWeight: T.weight.bold, marginBottom: T.space[0] }}>Could not load</div>
        <div style={{ color: T.color.inkMuted, fontSize: T.size.sm }}>{error}</div>
        <button onClick={onRetry} style={{ marginTop: T.space[2] }}>Try again</button>
      </div>
    );

  if (!data || (Array.isArray(data) && data.length === 0))
    return (
      <div style={{ padding: T.space[5], textAlign: "center", color: T.color.inkMuted }}>
        Nothing to show yet.
      </div>
    );

  return (
    <div style={{ padding: T.space[3], color: T.color.ink, background: T.color.surface }}>
      {/* TODO port the template body from ${origin} */}
    </div>
  );
}
`;
