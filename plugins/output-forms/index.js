import { identifier, jsString } from "../dsp-ir/emit.js";

/**
 * Each recovered form as a schema module and a framework free validator.
 *
 * The validator speaks the app's own words where the app was heard saying
 * any: an observed complaint becomes the message for its rule, because the
 * people using the rebuilt form already know what "Customer is required"
 * means and do not need a politer synonym breaking their muscle memory.
 *
 *   forms: true
 */

const pascal = (name) => identifier(String(name).split(/[^a-zA-Z0-9]+/).map((p) => p ? p[0].toUpperCase() + p.slice(1) : "").join(""), "Form");

export function renderSchema(form) {
  const fields = form.fields.map((field) => {
    const rules = [];
    const c = field.constraints ?? {};
    // An observed complaint is a rule the server actually enforces. The words
    // say which kind: "is required" is a required rule wearing its message.
    const observed = field.observed?.message ?? (typeof field.observed === "string" ? field.observed : null);
    const observedKind = observed
      ? /required/i.test(observed) ? "required"
        : /too short/i.test(observed) ? "minlength"
        : /too long/i.test(observed) ? "maxlength"
        : /not valid|invalid|format/i.test(observed) ? "pattern-like"
        : null
      : null;
    if (c.required === true || observedKind === "required") {
      rules.push(`{ kind: "required", message: ${jsString(observed && observedKind === "required" ? observed : messageFor(field, "required"))} }`);
    }
    if (observed && observedKind !== "required") {
      rules.push(`// Observed but not mappable to a static check: ${observed.replace(/\n/g, " ")}`);
    }
    if (typeof c.pattern === "string") rules.push(`{ kind: "pattern", value: ${jsString(c.pattern)}, message: ${jsString(messageFor(field, "pattern"))} }`);
    for (const k of ["min", "max", "minlength", "maxlength"]) {
      if (typeof c[k] === "string" || typeof c[k] === "number") rules.push(`{ kind: ${jsString(k)}, value: ${jsString(String(c[k]))}, message: ${jsString(messageFor(field, k))} }`);
    }
    if (c.type) rules.push(`{ kind: "type", value: ${jsString(c.type)}, message: ${jsString(messageFor(field, c.type))} }`);
    for (const [k, v] of Object.entries(c)) {
      if (v && typeof v === "object" && v.conditional) {
        rules.push(`// ${k} applies only when \`${v.conditional}\`; the condition lives in the component.`);
      }
    }
    return `  ${identifier(field.name, "field")}: {
    label: ${jsString(field.name)},
    from: ${jsString(field.from ?? "markup")},${field.observed ? `\n    observedComplaint: ${jsString(field.observed.message ?? String(field.observed))},` : ""}
    rules: [
${rules.map((r) => `      ${r},`).join("\n")}
    ],
  },`;
  });

  return `/**
 * Recovered from ${form.file} by portamp. Messages marked observed are the
 * app's own words, heard when the original was fed input it refused.
 */
export const schema = {
${fields.join("\n")}
};

/** Framework free. Returns {} when everything passes. */
export function validate(values) {
  const errors = {};
  for (const [name, field] of Object.entries(schema)) {
    const value = values?.[name];
    const empty = value === undefined || value === null || String(value).trim() === "";
    for (const rule of field.rules) {
      if (rule.kind === "required" && empty) { errors[name] = rule.message; break; }
      if (empty) continue;
      if (rule.kind === "pattern" && !new RegExp(rule.value).test(String(value))) { errors[name] = rule.message; break; }
      if (rule.kind === "minlength" && String(value).length < Number(rule.value)) { errors[name] = rule.message; break; }
      if (rule.kind === "maxlength" && String(value).length > Number(rule.value)) { errors[name] = rule.message; break; }
      if (rule.kind === "min" && Number(value) < Number(rule.value)) { errors[name] = rule.message; break; }
      if (rule.kind === "max" && Number(value) > Number(rule.value)) { errors[name] = rule.message; break; }
      if (rule.kind === "type" && rule.value === "email" && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(String(value))) { errors[name] = rule.message; break; }
      if (rule.kind === "type" && rule.value === "number" && Number.isNaN(Number(value))) { errors[name] = rule.message; break; }
    }
  }
  return errors;
}
`;
}

function messageFor(field, kind) {
  if (field.observed?.message) return field.observed.message;
  if (typeof field.observed === "string") return field.observed;
  const label = field.name;
  return {
    required: `${label} is required`,
    pattern: `${label} is not in the expected format`,
    min: `${label} is too small`,
    max: `${label} is too large`,
    minlength: `${label} is too short`,
    maxlength: `${label} is too long`,
    email: `${label} must be an email address`,
    number: `${label} must be a number`,
  }[kind] ?? `${label} is invalid`;
}

export default {
  name: "output-forms",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.forms) return log.debug("not requested");
      if (!ctx.forms?.length) return log.info("no recovered forms to emit");

      for (const form of ctx.forms) {
        await ctx.write(`src/forms/${pascal(form.screen)}.schema.js`, renderSchema(form));
      }
      log.info(`${ctx.forms.length} schema(s) with validators`);
    });
  },
};
