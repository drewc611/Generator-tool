import { toAngular } from "./print.js";
import { identifier } from "../dsp-ir/emit.js";

const pascal = (sel) => identifier(String(sel).split(/[-_\s]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(""), "Screen");
const camel = (s) => { const p = pascal(s); return p[0].toLowerCase() + p.slice(1); };

/**
 * Modern Angular as a target, which closes a loop: an AngularJS controller
 * from 2013 comes out the far end as a standalone component saying @for,
 * having passed through a middle that knows neither of them.
 *
 * Standalone, signal inputs, block control flow. The five year old dialect
 * this tool reads is not the Angular it writes, and that gap is the point.
 *
 *   angular: true
 */
export default {
  name: "output-angular",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.angular) return log.debug("not requested");

      let emitted = 0;
      for (const screen of ctx.screens) {
        const name = pascal(screen.selector);
        const result = screen.template ? toAngular(screen.template) : null;
        const collection = result?.collections[0] ?? "data";
        const inputs = [...new Set([...screen.inputs, ...(result?.reads ?? []), "loading", "error"])];
        await ctx.write(`src/app/${screen.selector}/${screen.selector}.component.ts`, COMPONENT({ name, selector: screen.selector, inputs, outputs: screen.outputs, result, collection, screen }));
        emitted += 1;
      }
      log.info(`${emitted} standalone component(s), block syntax`);
    });
  },
};

const COMPONENT = ({ name, selector, inputs, outputs, result, collection, screen }) => {
  const models = result?.models ?? [];
  const empty = collection === "data" ? "!this.data || (Array.isArray(this.data) && this.data.length === 0)" : `!this.${collection} || this.${collection}.length === 0`;

  return `import { Component, EventEmitter, Input, Output } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";

/**
 * Ported from ${screen.file} by portamp.
 *
 * Every state below is present on purpose. Delete one only when you have
 * checked the legacy screen genuinely cannot reach it.
 */
@Component({
  selector: "${selector}",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: \`
    @if (loading) {
      <p class="state state--loading">Loading…</p>
    } @else if (error) {
      <div class="state state--error">
        <strong>Could not load</strong>
        <p>{{ errorText }}</p>
        <button type="button" (click)="retry.emit()">Try again</button>
      </div>
    } @else if (empty) {
      <p class="state state--empty">Nothing to show yet.</p>
    } @else {
${result ? result.markup.replace(/\`/g, "\\\`") : "      <!-- No template was found for this component. -->"}
    }
  \`,
})
export class ${name}Component {
${inputs.map((i) => `  @Input() ${i}: any;`).join("\n")}
${outputs.map((o) => `  @Output() ${o} = new EventEmitter<any>();`).join("\n")}
  @Output() retry = new EventEmitter<void>();
${models.map((m) => `  ${m.split(".").pop().replace(/[^\w$]/g, "")} = "";`).join("\n")}

  get errorText() { return this.error ? String(this.error.message ?? this.error) : ""; }
  get empty() { return ${empty}; }
}
`;
};
