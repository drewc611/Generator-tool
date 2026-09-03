import { balanced, topLevelBlocks } from "../dsp-ir/scan.js";

/**
 * Knockout packs every binding into one data-bind attribute. The dialect
 * table wants one attribute per meaning, so this pass expands
 *
 *   <span data-bind="text: name, visible: isOn, click: pick"></span>
 *
 * into ko-* attributes the table can read, and injects the text and html
 * bindings as content, which is where their meaning lives.
 */

/** Split a binding list on the commas that are not inside anything. */
export function bindings(value) {
  const out = [];
  let depth = 0;
  let start = 0;
  const text = String(value ?? "");
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      const q = c; i += 1;
      while (i < text.length && (text[i] !== q || text[i - 1] === "\\")) i += 1;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth += 1;
    else if (c === "}" || c === "]" || c === ")") depth -= 1;
    else if ((c === "," || i === text.length) && depth === 0) {
      const part = text.slice(start, i).trim();
      if (part) {
        const colon = part.indexOf(":");
        if (colon > 0) out.push({ name: part.slice(0, colon).trim(), value: part.slice(colon + 1).trim() });
      }
      start = i + 1;
    }
  }
  return out;
}

const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * Containerless bindings live in comments: <!-- ko if: x --> ... <!-- /ko -->.
 * They become ng-container elements carrying the same ko-* attributes, which
 * then dissolve in the IR, exactly as knockout dissolves the comments. A
 * containerless foreach names its row `item` and `$data` is rewritten to it;
 * bare property names stay as written and the gap is named.
 */
export function expandContainerless(html, note = () => {}) {
  let text = String(html ?? "");
  if (!/<!--\s*ko\s/.test(text)) return text;

  text = text.replace(/<!--\s*ko\s+(if|ifnot|foreach|with)\s*:\s*([\s\S]*?)-->/g, (whole, kind, raw) => {
    const value = raw.trim();
    if (kind === "if" || kind === "ifnot") {
      return `<ng-container ko-if="${esc(kind === "ifnot" ? `!(${value})` : value)}">`;
    }
    if (kind === "foreach") {
      note(
        "A containerless foreach names no row, so inside it every bare name means a property of the row. " +
        "The port calls the row `item` and rewrites `$data` to it; prefix bare row fields with `item.` by hand."
      );
      return `<ng-container ko-foreach="${esc(`item in ${value}`)}">`;
    }
    note(`A containerless \`${kind}: ${value}\` rescopes its children. The children are kept and the rescope dropped; prefix their references with \`${value}.\` by hand.`);
    return `<ng-container>`;
  });
  text = text.replace(/<!--\s*\/ko\s*-->/g, "</ng-container>");
  // knockout's name for the current row, spelled as the name the loop got.
  return text.replace(/\$data\b/g, "item");
}

export function expand(html, note = () => {}) {
  const text = expandContainerless(String(html ?? ""), note);
  if (!/data-bind\s*=/.test(text)) return text;

  return text.replace(/<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g, (whole, tag, attrs, selfClose) => {
    const m = /\sdata-bind\s*=\s*(['"])([\s\S]*?)\1/.exec(attrs);
    if (!m) return whole;

    const rest = attrs.replace(m[0], "");
    const expanded = [];
    let content = "";

    for (const { name, value } of bindings(m[2])) {
      switch (name) {
        case "text": content = `{{${value}}}`; break;
        case "html": expanded.push(`ko-html="${esc(value)}"`); break;
        case "if": case "ifnot": expanded.push(`ko-if="${esc(name === "ifnot" ? `!(${value})` : value)}"`); break;
        case "visible": expanded.push(`ko-visible="${esc(value)}"`); break;
        case "hidden": expanded.push(`ko-visible="${esc(`!(${value})`)}"`); break;
        case "foreach": {
          // foreach: items, or foreach: { data: items, as: 'o' }.
          const object = value.startsWith("{") ? value : null;
          const data = object ? /data\s*:\s*([^,}]+)/.exec(object)?.[1]?.trim() : value;
          const as = object ? /as\s*:\s*['"]([\w$]+)['"]/.exec(object)?.[1] : null;
          if (!as) {
            note(
              `A foreach over \`${data}\` has no \`as\` alias, so inside it every bare name means a property of ` +
              `the row. The port keeps \`$data\` as the row; alias the loop (as: 'row') in the source, or fix ` +
              `the references by hand.`
            );
          }
          expanded.push(`ko-foreach="${esc(`${as ?? "$data"} in ${data}`)}"`);
          break;
        }
        case "value": case "textInput": expanded.push(`ko-model="${esc(value)}"`); break;
        case "checked": expanded.push(`ko-model="${esc(value)}"`); break;
        case "css": expanded.push(`ko-css="${esc(value)}"`); break;
        case "style": expanded.push(`ko-styles="${esc(value)}"`); break;
        case "attr": {
          const body = value.startsWith("{") ? value.slice(1, -1) : "";
          for (const entry of bindings(body)) expanded.push(`ko-attr-${entry.name.replace(/['"]/g, "")}="${esc(entry.value)}"`);
          break;
        }
        case "click": case "submit": case "change": case "focus": case "blur": case "keyup": case "keydown":
          expanded.push(`ko-on-${name}="${esc(value)}"`); break;
        case "enable": expanded.push(`ko-attr-disabled="${esc(`!(${value})`)}"`); break;
        case "disable": expanded.push(`ko-attr-disabled="${esc(value)}"`); break;
        case "with": case "using":
          note(`A \`${name}: ${value}\` binding rescopes its children. The port keeps the children and drops the rescope; prefix their references with \`${value}.\` by hand.`);
          break;
        case "template":
          note(`A template binding (\`${value}\`) renders markup from elsewhere in the page. It was left as a gap rather than resolved by guesswork.`);
          break;
        default:
          note(`The \`${name}\` binding has no mapping. Its expression (\`${value}\`) was kept as an attribute so it stays visible.`);
          expanded.push(`ko-unmapped-${name}="${esc(value)}"`);
      }
    }

    const opened = `<${tag}${rest}${expanded.length ? " " + expanded.join(" ") : ""}${selfClose}>`;
    return content && !selfClose ? `${opened}${content}` : opened;
  });
}
