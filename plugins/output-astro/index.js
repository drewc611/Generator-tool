import { pascal, unique } from "../dsp-ir/emit.js";

/**
 * The Astro target. Astro renders static HTML at build time and hydrates only
 * the interactive parts, so the honest Astro port of a screen with client
 * state is not a rewrite of that screen into Astro's own dialect, which would
 * silently drop every handler. It is an Astro island: the page imports the
 * React component this run already emitted and hands it a hydration directive.
 *
 * That is why this printer touches no template. It composes the proven output
 * instead of translating a second time, which is the same reason output-site,
 * output-next and output-remix import components rather than copy them.
 *
 *   astro: true
 */
export default {
  name: "output-astro",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.astro) return log.debug("not requested");

      let emitted = 0;
      for (const screen of ctx.screens) {
        const Name = pascal(screen.selector) || "Screen";
        const props = unique([
          ...screen.inputs,
          ...screen.outputs.map((o) => `on${pascal(o)}`),
          "loading", "error", "onRetry",
        ]);
        await ctx.write(`src/astro/${Name}.astro`, PAGE({ Name, props, screen }));
        emitted += 1;
      }
      if (emitted) {
        await ctx.write("src/astro/README.md", README);
        ctx.note("Astro output composes the React components as islands. Run `npx astro add react` in the port so the client directive resolves.");
      }
      log.info(`${emitted} astro island(s)`);
    });
  },
};

const PAGE = ({ Name, props, screen }) => `---
// Ported from ${screen.file} by portamp. Astro island target.
//
// Astro renders this page's static shell at build time and hydrates the
// component below on the client. The component is the React one this run
// already emitted; its every state travels with it, unchanged.
import ${Name} from "../features/${Name}/${Name}.jsx";

const { ${props.map((p) => `${p} = undefined`).join(", ")} } = Astro.props;
---

<${Name}
  client:load
${props.map((p) => `  ${p}={${p}}`).join("\n")}
/>
`;

const README = `# The Astro islands

Each \`.astro\` file here is a page that hydrates one ported component as an
island, importing it from \`src/features\`. This is the honest Astro port of a
screen that has client state: Astro serves the static shell and hydrates the
component with \`client:load\`, so no handler is lost to a second translation.

To build, the port needs Astro's React integration:

\`\`\`bash
npx astro add react
\`\`\`

Change \`client:load\` to \`client:visible\` or \`client:idle\` to defer
hydration where a screen is below the fold.
`;
