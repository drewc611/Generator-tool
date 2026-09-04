import { toVue } from "./print.js";
import { jsString, pascal } from "../dsp-ir/emit.js";


const unique = (list) => [...new Set(list.filter(Boolean))];

/**
 * The third target, and the one that closes the argument.
 *
 * A Vue app can be read by input-vue and emitted by output-react, and an
 * Angular app can be read by input-angular and emitted by this. The pairing is
 * free because neither side knows the other exists; both only know the IR.
 *
 *   vue: true
 */
export default {
  name: "output-vue",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.vue) return log.debug("not requested");

      let emitted = 0;
      for (const screen of ctx.screens) {
        const name = pascal(screen.selector) || "Screen";
        const result = screen.template ? toVue(screen.template) : null;
        const collection = result?.collections[0] ?? "data";
        const props = unique([...screen.inputs, ...(result?.reads ?? []), "loading", "error"]);
        const emits = unique([...screen.outputs, "retry"]);

        // A tag naming another screen in the run is that screen, ported. In
        // Vue the kebab tag resolves the moment its component is imported,
        // so resolving a reference costs exactly one import line.
        const referenced = ctx.screens
          .filter((other) => other !== screen && result?.markup && new RegExp(`<${other.selector}[\\s>/]`).test(result.markup))
          .map((other) => pascal(other.selector) || "Screen");

        await ctx.write(`src/features/${name}/${name}.vue`, COMPONENT({ name, props, emits, result, collection, screen, referenced: unique(referenced) }));
        emitted += 1;
      }
      log.info(`${emitted} vue component(s)`);
    });
  },
};

const COMPONENT = ({ name, props, emits, result, collection, screen, referenced = [] }) => {
  const models = result?.models ?? [];
  const imports = referenced.map((r) => `import ${r} from "../${r}/${r}.vue";`).join("\n");
  const state = models
    .map((m) => `const ${m.split(".").pop().replace(/[^\w$]/g, "")} = ref("");`)
    .join("\n");

  const empty = collection === "data"
    ? "!data || (Array.isArray(data) && data.length === 0)"
    : `!${collection} || ${collection}.length === 0`;

  return `<script setup>
${models.length ? 'import { ref } from "vue";\n' : ""}${imports ? imports + "\n" : ""}// Ported from ${screen.file} by portamp.
//
// Every state below is present on purpose. Delete one only when you have
// checked the legacy screen genuinely cannot reach it.
defineProps({
${props.map((p) => `  ${p}: { type: null, default: undefined },`).join("\n")}
});
defineEmits([${emits.map(jsString).join(", ")}]);
${state}
</script>

<template>
  <p v-if="loading" class="state state--loading">Loading…</p>

  <div v-else-if="error" class="state state--error">
    <strong>Could not load</strong>
    <p>{{ error.message ?? error }}</p>
    <button type="button" @click="$emit('retry')">Try again</button>
  </div>

  <p v-else-if="${empty}" class="state state--empty">Nothing to show yet.</p>

  <template v-else>
${result ? result.markup : "    <!-- No template was found for this component. -->"}
  </template>
</template>
`;
};
