import { translate } from "./template.js";

const pascal = (sel) =>
  sel.split(/[-_]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

const unique = (list) => [...new Set(list.filter(Boolean))];

/**
 * Emits one React component per Angular component. The template is translated
 * where there is one to translate, and every state is present either way: an
 * empty state that renders nothing is the single most common thing a port
 * forgets, and it is invisible in review because the screen looks fine when
 * the data happens to be there.
 */
export default {
  name: "output-react",
  version: "0.2.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      let translated = 0;

      for (const s of ctx.screens) {
        const Name = pascal(s.selector) || "Screen";
        const notes = [];
        if (s.usesTwoWay) notes.push(" * Two way binding in the original. Every input here is controlled.");
        if (s.rxjs.length)
          notes.push(` * RxJS in the original: ${s.rxjs.join(", ")}. Mapped to hooks, not ported one for one.`);

        let body = null;
        let models = [];
        let props = unique([...s.inputs, ...s.outputs.map((o) => `on${pascal(o)}`)]);
        let collection = "data";

        if (s.template) {
          const result = translate(s.template, { indent: 3 });
          body = result.jsx;
          models = result.models;
          collection = result.collections[0] ?? "data";
          props = unique([...props, ...result.reads]);
          translated += 1;
          notes.push(` * Template translated from ${s.templateOrigin ?? "the decorator"}.`);
          // dsp-ir already reported what the template could not carry across.
          // Reporting it again here would list every caveat twice.
        } else {
          notes.push(" * No template was found, so the body below is a placeholder.");
        }

        props = unique([...props, "loading", "error", "onRetry"]);
        const usesChildren = Boolean(body && body.includes("{children}"));
        if (usesChildren) props.push("children");

        await ctx.write(
          `src/features/${Name}/${Name}.jsx`,
          COMPONENT({ Name, props, notes, origin: s.file, body, models, collection })
        );
      }

      log.info(
        `${ctx.screens.length} component(s) emitted` +
          (ctx.screens.length ? `, ${translated} template(s) translated` : "")
      );
    });
  },
};

const PLACEHOLDER = (origin) =>
  `      {/* No template was found for this component. Port the body from ${origin}. */}`;

const COMPONENT = ({ Name, props, notes, origin, body, models, collection }) => {
  const state = models
    .map((m) => {
      const leaf = m.split(".").pop().replace(/[^\w$]/g, "");
      return `  const [${leaf}, set${leaf.charAt(0).toUpperCase()}${leaf.slice(1)}] = useState("");`;
    })
    .join("\n");

  const empty =
    collection === "data"
      ? "!data || (Array.isArray(data) && data.length === 0)"
      : `!${collection} || ${collection}.length === 0`;

  return `import React${models.length ? ", { useState }" : ""} from "react";
import { tokens as T } from "../../tokens.js";

/**
 * Ported from ${origin}
${notes.length ? notes.join("\n") : " *"}
 *
 * Every state below is present on purpose. Delete one only when you have
 * checked the legacy screen genuinely cannot reach it.
 */
export default function ${Name}({ ${props.join(", ")} }) {
${state ? state + "\n" : ""}  if (loading) return <div style={{ padding: T.space[4], color: T.color.inkMuted }}>Loading…</div>;

  if (error)
    return (
      <div style={{ padding: T.space[4] }}>
        <div style={{ fontWeight: T.weight.bold, marginBottom: T.space[0] }}>Could not load</div>
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
${body ?? PLACEHOLDER(origin)}
    </div>
  );
}
`;
};
