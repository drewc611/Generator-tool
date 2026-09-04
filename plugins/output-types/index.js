import { pascal, unique } from "../dsp-ir/emit.js";

/**
 * The types target. The port's components stay .jsx, so this plugin never
 * touches them; it writes a types folder beside them so a consumer that wants
 * a type surface has one. Every prop is `unknown` rather than `any`, because
 * the reader knows the name a screen reads or emits, not the shape behind it,
 * and unknown forces the consumer to narrow rather than pretending the tool
 * proved a type it did not.
 */

export default {
  name: "output-types",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.types) return log.debug("not requested");

      const interfaces = ctx.screens.map((screen) => {
        const Name = pascal(screen.selector) || "Screen";
        const lines = [];
        for (const input of unique(screen.inputs ?? [])) {
          lines.push(`  ${propName(input)}?: unknown;`);
        }
        for (const output of unique(screen.outputs ?? [])) {
          lines.push(`  on${pascal(output)}?: (...args: unknown[]) => void;`);
        }
        lines.push("  loading?: boolean;");
        lines.push("  error?: unknown;");
        lines.push("  onRetry?: () => void;");
        return `export interface ${Name}Props {\n${unique(lines).join("\n")}\n}`;
      });

      await ctx.write("src/types/props.d.ts", PROPS_HEADER + interfaces.join("\n\n") + "\n");
      let files = 1;

      const calls = ctx.api?.calls ?? [];
      if (calls.length) {
        const paths = unique(calls.map((c) => c.path));
        const methods = unique(calls.map((c) => c.method));
        const pathUnion = paths.map((p) => literal(p)).join(" | ");
        const methodUnion = methods.map((m) => literal(m)).join(" | ");
        const api =
          API_HEADER +
          `export type ApiPath = ${pathUnion};\n\n` +
          `export type ApiMethod = ${methodUnion};\n`;
        await ctx.write("src/types/api.d.ts", api);
        files += 1;
      }

      log.info(`${files} type declaration file(s)`);
    });
  },
};

/**
 * A prop name that is also a legal object member. A reader can carry a name
 * with a hyphen or a dot; quoting it keeps the declaration parsing rather than
 * inventing a spelling the component never used.
 */
function propName(name) {
  const raw = String(name ?? "");
  return /^[A-Za-z_$][\w$]*$/.test(raw) ? raw : literal(raw);
}

/** A double quoted string literal for a declaration, with the quote escaped. */
function literal(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const PROPS_HEADER = `// Inferred from what each screen reads and emits, not declared by hand.
// Every prop is optional and mostly unknown: the reader proved the name a
// screen uses, never the type behind it, so unknown means unproven here, not
// that any value is acceptable. Narrow it where the consumer knows more.

`;

const API_HEADER = `// The API surface the run observed, as string literal unions. These name the
// paths and methods the source proved it calls, and nothing about the shapes
// that travel over them.

`;
