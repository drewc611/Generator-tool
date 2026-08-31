import { readFile } from "node:fs/promises";
import { buildIr, DIALECTS } from "../dsp-ir/ir.js";
import { parse } from "../dsp-ir/parse.js";

/**
 * The validation rules, recovered as one schema per form.
 *
 * A legacy form's rules live in three places at once: attributes on the
 * fields, framework directives, and the complaints the app was seen making
 * when input-explore fed it nonsense. This collects all three into one place,
 * with each rule carrying where it came from, because a rule recovered from
 * an observed complaint is worth more than one from markup: it is the
 * server's actual opinion, in the app's own words.
 *
 * It collects and does not enforce. Which rules the rebuilt form keeps is a
 * product decision; what this guarantees is that nobody rediscovers them one
 * support ticket at a time.
 */

const FIELD_TAGS = new Set(["input", "select", "textarea"]);

const attrValue = (node, name) => {
  const found = (node.attrs ?? []).find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (!found) return undefined;
  return found.kind === "flag" ? true : found.kind === "static" ? found.value : found.kind === "bound" ? { expression: found.expression } : undefined;
};

export function fieldsFromIr(ir) {
  const fields = [];
  let submits = 0;

  const walk = (node) => {
    if (!node) return;
    if (node.kind === "element") {
      const tag = String(node.tag ?? "").toLowerCase();
      if (FIELD_TAGS.has(tag)) {
        const constraints = {};
        for (const key of ["required", "pattern", "min", "max", "minlength", "maxlength", "step"]) {
          const v = attrValue(node, key);
          if (v !== undefined) constraints[key] = v === true ? true : v;
        }
        const type = attrValue(node, "type");
        if (typeof type === "string" && /^(email|number|url|tel|date|password)$/.test(type)) constraints.type = type;
        if (tag === "select") constraints.oneOf = "the options in the markup";
        // ng-required and friends: a bound constraint is conditional, which
        // is itself worth knowing.
        for (const attr of node.attrs ?? []) {
          const m = /^(?:data-)?ng-(required|pattern|minlength|maxlength)$/.exec(attr.name);
          if (m) constraints[m[1]] = { conditional: attr.kind === "bound" ? attr.expression : attr.value };
        }
        const name = node.model?.split(".").pop()
          ?? (typeof attrValue(node, "name") === "string" ? attrValue(node, "name") : undefined)
          ?? (typeof attrValue(node, "id") === "string" ? attrValue(node, "id") : undefined);
        if (name) fields.push({ name, tag, constraints, from: "markup" });
      }
      if (tag === "button" || tag === "form") {
        const type = attrValue(node, "type");
        if (tag === "form" || type === "submit") submits += 1;
      }
      node.children.forEach(walk);
    } else if (node.children) node.children.forEach(walk);
  };
  walk(ir.root);
  return { fields, submits };
}

export default {
  name: "dsp-forms",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const forms = [];

      for (const screen of ctx.screens.filter((s) => s.template)) {
        const ir = screen.ir ?? buildIr(screen.template, { dialect: DIALECTS[screen.dialect] });
        const { fields, submits } = fieldsFromIr(ir);
        if (fields.length && submits) forms.push({ screen: screen.selector, file: screen.file, fields });
      }

      // A page nothing claimed can still hold a form; the parser is dialect
      // free so a plain html file reads the same way.
      const claimed = new Set(ctx.screens.map((s) => s.file));
      for (const file of ctx.sources.files.filter((f) => /\.html?$/.test(f.rel) && !claimed.has(f.rel))) {
        const html = await readFile(file.path, "utf8").catch(() => "");
        if (!html || !/<form/i.test(html)) continue;
        const { fields, submits } = fieldsFromIr(buildIr(html.replace(/<script[\s\S]*?<\/script>/gi, "")));
        if (fields.length && submits) forms.push({ screen: file.rel, file: file.rel, fields });
      }

      // What the app was seen complaining about outranks what the markup says:
      // it is the server's actual opinion, in the app's own words.
      for (const observed of ctx.model?.screens ?? []) {
        if (observed.kind !== "form" || !observed.fields?.length) continue;
        let form = forms.find((f) => f.screen === observed.id || f.screen === observed.name);
        if (!form) { form = { screen: observed.name ?? observed.id, file: "observed", fields: [] }; forms.push(form); }
        for (const field of observed.fields) {
          const existing = form.fields.find((f) => f.name === field.name);
          const rule = field.validation ?? null;
          if (existing) {
            if (rule) existing.observed = rule;
          } else {
            form.fields.push({ name: field.name, tag: "input", constraints: {}, observed: rule, from: "observed" });
          }
        }
      }

      if (!forms.length) return log.debug("no forms to read");
      ctx.forms = forms;
      const observedRules = forms.flatMap((f) => f.fields).filter((f) => f.observed).length;
      log.info(`${forms.length} form(s), ${forms.reduce((a, f) => a + f.fields.length, 0)} field(s), ${observedRules} rule(s) observed live`);
    });

    on("emit", async (ctx) => {
      if (!ctx.forms) return;
      await ctx.write("FORMS.md", render(ctx.forms));
    });
  },
};

function render(forms) {
  const sections = forms.map((form) => {
    const rows = form.fields.map((f) => {
      const constraints = Object.entries(f.constraints)
        .map(([k, v]) => (v === true ? k : typeof v === "object" ? `${k} (conditional: \`${v.conditional ?? v.expression}\`)` : `${k}=${v}`))
        .join(", ") || "none in the markup";
      const observed = f.observed ? `"${f.observed.message ?? f.observed}"` : "—";
      return `| \`${f.name}\` | ${constraints} | ${observed} |`;
    });
    return `### ${form.screen}\n\n| field | markup says | the app was heard saying |\n| --- | --- | --- |\n${rows.join("\n")}`;
  });

  return `# The rules the forms enforce

Collected from the markup and from the complaints the app was observed making.
An observed complaint outranks a markup attribute: it is the server's actual
opinion, in the app's own words, and the rebuilt form should say the same
words rather than inventing politer ones.

${sections.join("\n\n")}

---

Nothing here is enforced by portamp. Which rules the rebuilt form keeps is a
product decision; this exists so nobody rediscovers them one support ticket at
a time. Turn on \`--forms true\` to emit each schema as code.
`;
}
