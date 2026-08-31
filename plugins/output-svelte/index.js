import { toSvelte } from "./print.js";

const pascal = (sel) =>
  String(sel).split(/[-_\s]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

const unique = (list) => [...new Set(list.filter(Boolean))];

/**
 * A second target, to keep the first one honest.
 *
 * Nothing in the reader, the endpoint map, the token extractor or the IR knows
 * this exists. If emitting Svelte had needed any of them to change, the claim
 * that the core is framework blind would have been decoration.
 *
 *   svelte: true
 */
export default {
  name: "output-svelte",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.svelte) return log.debug("not requested");

      let emitted = 0;
      for (const screen of ctx.screens) {
        const name = pascal(screen.selector) || "Screen";
        const result = screen.template ? toSvelte(screen.template) : null;
        const collection = result?.collections[0] ?? "data";
        const props = unique([
          ...screen.inputs,
          ...screen.outputs.map((o) => `on${pascal(o)}`),
          ...(result?.reads ?? []),
          "loading", "error", "onRetry",
        ]);

        await ctx.write(`src/features/${name}/${name}.svelte`, COMPONENT({ name, props, result, collection, screen }));
        emitted += 1;
      }
      log.info(`${emitted} svelte component(s)`);
    });
  },
};

const COMPONENT = ({ name, props, result, collection, screen }) => {
  const state = (result?.models ?? []).map((m) => {
    const leaf = m.split(".").pop().replace(/[^\w$]/g, "");
    return `  let ${leaf} = "";`;
  }).join("\n");

  const empty = collection === "data"
    ? "!data || (Array.isArray(data) && data.length === 0)"
    : `!${collection} || ${collection}.length === 0`;

  return `<script>
  // Ported from ${screen.file} by portamp.
  //
  // Every state below is present on purpose. Delete one only when you have
  // checked the legacy screen genuinely cannot reach it.
${props.map((p) => `  export let ${p} = undefined;`).join("\n")}
${state}
</script>

{#if loading}
  <p class="state state--loading">Loading…</p>
{:else if error}
  <div class="state state--error">
    <strong>Could not load</strong>
    <p>{error.message ?? error}</p>
    <button on:click={onRetry}>Try again</button>
  </div>
{:else if ${empty}}
  <p class="state state--empty">Nothing to show yet.</p>
{:else}
${result ? result.markup : "  <!-- No template was found for this component. -->"}
{/if}
`;
};
