import { pascal } from "../dsp-ir/emit.js";
import { tokenizeRow } from "./parse.js";

/**
 * What one ISPF panel means, once parse.js has handed over its `)BODY` rows
 * and its effective attribute map. There is no container tree here, the
 * same flat "row and column order is the layout" shape input-informix and
 * input-cics already read; fields are ordered by reading order (top to
 * bottom, left to right), not by any declaration order, since ISPF declares
 * none.
 *
 * A `TYPE(INPUT)` run's content is not a label or a literal: it is ISPF's
 * own convention for a variable name, read directly off the body text with
 * nothing declared elsewhere to confirm it. A `TYPE(OUTPUT)` run is program
 * set and read only, rendered the same honest way input-informix already
 * renders a NOENTRY field: a bare `{{ name }}` interpolation, a value the
 * port is handed rather than one this reader invents. `TYPE(TEXT)` content,
 * and content under an attribute character this reader could not resolve a
 * type for (already named once by parse.js), both become a plain caption;
 * a separator row of dashes is exactly that, never special-cased.
 *
 * ISPF names no button, no submit and no event anywhere in a panel body:
 * navigation is PF-keys and `)PROC` validation logic entirely outside
 * `)BODY`, which this reader does not read. This reader always produces
 * zero outputs, the same honest zero input-jasperreports, input-birt,
 * input-cics and input-informix already establish for a format with
 * nothing to wire.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** kebab-cased text to camelCase, the spelling ng-model and a JS declaration both need. Not shared with the other
 * readers' own copies of this: the naming conventions differ reader to reader, and a shared helper here is how two
 * of them end up disagreeing about what a name is called. */
const camel = (text) => { const p = pascal(kebab(text)); return p ? p.charAt(0).toLowerCase() + p.slice(1) : ""; };
/** A name the emitted JavaScript can declare: a variable that spells a reserved word gets a suffix. Kept local, the
 * same restraint input-informix and input-flex keep over their own copies of this table. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

/**
 * One panel lowered onto the shared dialect. `stem` is the file's own name
 * (an ISPF panel names itself nowhere else); `index` numbers a panel among
 * others read from the same file, for a stable stem/title when a file
 * carries more than one `)BODY` (rare, never assumed).
 */
export function lowerIspf(panel, stem = "ispf-panel", index = 1) {
  const notes = [...panel.attrNotes];
  const note = (text) => { if (!notes.includes(text)) notes.push(text); };

  if (!panel.hadAttrSection) {
    note("no )ATTR section; read with ISPF's own built-in defaults (% and + as protected text, a lone _ as an enterable field).");
  }
  if (panel.initPresent || panel.procPresent) {
    const which = panel.initPresent && panel.procPresent ? ")INIT and )PROC sections" : panel.initPresent ? "an )INIT section" : "a )PROC section";
    note(`this panel carries ${which} with Dialog Manager logic (variable defaults, VER validation, .ZVARS assignments) this reader does not read for meaning.`);
  }

  const lines = [];
  const fields = [];
  const declaredNames = new Map(); // raw ISPF variable name (as written) -> its declared JS name, so the same variable named twice reuses one identifier
  let heading = null;
  let firstContentRow = true;

  panel.bodyLines.forEach((row, rowIndex) => {
    const runs = tokenizeRow(row, panel.attrMap);
    if (!runs.length) return;

    const parts = [];
    let hasField = false;
    for (const run of runs) {
      if (run.type === "INPUT" || run.type === "OUTPUT") {
        hasField = true;
        const raw = run.content.trim().split(/\s+/)[0] ?? "";
        if (!raw) {
          note(`row ${rowIndex + 1}: the \`${run.char}\` attribute character introduces no variable name (only padding follows it); nothing was rendered for it.`);
          continue;
        }
        let name = declaredNames.get(raw);
        if (!name) {
          name = declarable(camel(raw)) || `field${fields.length + 1}`;
          declaredNames.set(raw, name);
        }
        if (run.type === "INPUT") {
          if (!fields.includes(name)) fields.push(name);
          parts.push(`<input id="f-${name}" type="text" ng-model="${name}">`);
        } else {
          parts.push(`<span>{{ ${name} }}</span>`);
        }
        continue;
      }
      // TYPE(TEXT), or a run whose attribute character has no resolvable type (already noted once by
      // parseAttrSection): both are a plain caption, since inventing enterability for a character this reader
      // could not place would be the guess ISPF's own convention forbids.
      const text = run.content.trim();
      if (text) parts.push(esc(text));
    }
    if (!parts.length) return;

    if (firstContentRow && !hasField) heading = parts.join(" ");
    else lines.push(`  <p>${parts.join(" ")}</p>`);
    firstContentRow = false;
  });

  const finalStem = index > 1 ? `${stem}-${index}` : stem;
  const className = pascal(finalStem);
  const template = ["<div>", ...(heading ? [`  <h2>${heading}</h2>`] : []), ...lines, "</div>"].join("\n");

  return {
    template,
    fields,
    outputs: [],
    notes,
    usesNgFor: false,
    usesTwoWay: fields.length > 0,
    className,
    title: heading || "ISPF Panel",
  };
}
