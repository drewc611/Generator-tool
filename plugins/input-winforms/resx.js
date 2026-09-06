import { attrOf, elements, parseMarkup, stripDelimited } from "../dsp-ir/markup.js";
import { decodeEntities } from "../dsp-ir/parse.js";

/**
 * The .resx beside a localized designer file, read for what the designer left
 * in it. When a form is marked Localizable the designer moves every caption,
 * location and size out of InitializeComponent and into `<Form>.resx`, one
 * `<data name="control.Property">` entry each, and the code calls
 * `resources.ApplyResources(this.control, "control")` to load them back. A
 * reader that stops at the designer code sees a form of controls with no
 * caption; this one takes the neutral .resx as the designer's other half,
 * applies exactly the entries the designer asked for on the controls it asked
 * for, and names the rest as present.
 *
 * The file is read from disk beside the designer rather than taken from the
 * scan's file list, because the designer file names it: the scan's KEEP set
 * is not this reader's to depend on and the resource file is meaningful only
 * next to the form that owns it. A culture variant (`<Form>.de.resx`) is
 * named and never opened, because which language the port speaks is a
 * decision about the product, not a fact in the source.
 */

/** A `<data>` entry's kind: text to apply, a file the .resx points at, or a serialized object it carries in base64. */
function kindOfEntry(type, mimetype) {
  if (/\bResXFileRef\b/.test(type ?? "")) return "file";
  if (mimetype) return "binary";
  return "text";
}

/**
 * The entries of a .resx, `>>` metadata, headers and assembly aliases set
 * aside. The Visual Studio header comment carries example `<data>` elements,
 * so comments are removed before the tree is built or the examples would read
 * as entries.
 */
export function readResx(xml) {
  const tree = parseMarkup(stripDelimited(String(xml ?? ""), "<!--", "-->"));
  const root = elements(tree.children).find((el) => el.tag === "root");
  const entries = [];
  for (const el of root ? elements(root.children) : []) {
    if (el.tag !== "data") continue;
    // The name is written `&gt;&gt;x.Name` or `>>x.Name` by different writers; decoded, both are the metadata rows.
    const name = decodeEntities(attrOf(el, "name") ?? "");
    // `>>control.Name`, `>>control.Type` and their siblings describe the entry set to the designer, not the control.
    if (!name || name.startsWith(">>")) continue;
    const type = attrOf(el, "type");
    const mimetype = attrOf(el, "mimetype");
    const kind = kindOfEntry(type, mimetype);
    const valueEl = elements(el.children).find((c) => c.tag === "value");
    const raw = valueEl ? valueEl.children.filter((c) => c.type === "text").map((c) => c.text).join("") : "";
    // A file path and a base64 blob are never decoded; the entry is known by its name alone.
    entries.push({ name, type: type ?? null, kind, value: kind === "text" ? decodeEntities(raw) : null });
  }
  return { entries };
}

/** The properties ApplyResources sets that the lowering can use; anything else the .resx carries is named, not taken. */
const APPLIED = new Set(["Text", "HeaderText", "Location", "Size", "Visible", "Enabled", "TabIndex", "Items"]);

const point = (value) => { const m = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(value ?? ""); return m ? [Number(m[1]), Number(m[2])] : null; };
const bool = (value) => (/^\s*true\s*$/i.test(value ?? "") ? true : /^\s*false\s*$/i.test(value ?? "") ? false : null);
const int = (value) => (/^\s*-?\d+\s*$/.test(value ?? "") ? Number(value) : null);

/**
 * The .resx applied to a form the designer read. Only a control the designer
 * passed to ApplyResources (or whose Text it took from GetString) receives
 * anything, and only a property the designer did not set inline, because an
 * inline assignment after ApplyResources is what the running form showed.
 * `$this` is the form itself and its Text is the title. Returns the record
 * WINFORMS.md and the notes print: what was applied, what was present and
 * not asked for, what points at a file, and what was left in the file.
 */
export function applyResx(read, resx, { file, cultures = [] } = {}) {
  const { form, controls } = read;
  const localized = (c) => c.localized || c.textResource || c.itemsResource;
  const summary = { file, cultures: [...cultures], captions: [], title: false, applied: 0, unapplied: [], files: [], left: new Map() };
  const leave = (owner, prop) => { if (!summary.left.has(owner)) summary.left.set(owner, []); summary.left.get(owner).push(prop); };
  const itemsBy = new Map();

  for (const e of resx.entries) {
    const dot = e.name.indexOf(".");
    const owner = dot < 0 ? e.name : e.name.slice(0, dot);
    const prop = dot < 0 ? "" : e.name.slice(dot + 1);
    if (e.kind !== "text") { summary.files.push(e.name); continue; }
    const target = owner === "$this" ? (form.localized || form.textResource ? form : null) : controls.has(owner) && localized(controls.get(owner)) ? controls.get(owner) : null;
    // An entry the designer never asked for is not the running form's; it is present and said so.
    if (!target) { summary.unapplied.push(e.name); continue; }
    const items = /^Items(\d*)$/.exec(prop);
    if (items && target !== form) {
      if (!itemsBy.has(owner)) itemsBy.set(owner, []);
      itemsBy.get(owner).push({ index: items[1] === "" ? 0 : Number(items[1]), value: e.value });
      continue;
    }
    if (!APPLIED.has(prop) || (target === form && prop !== "Text")) { leave(owner, prop); continue; }
    // The designer set it inline after ApplyResources, and the inline value is what the form showed.
    if (target.inline?.includes(prop)) { leave(owner, prop); continue; }
    switch (prop) {
      case "Text": target.text = e.value; target.resxText = true; if (target === form) summary.title = true; else summary.captions.push(owner); break;
      case "HeaderText": target.headerText = e.value; target.resxText = true; summary.captions.push(owner); break;
      case "Location": { const p = point(e.value); if (p) target.location = p; else target.unreadProps.push(prop); break; }
      case "Size": { const p = point(e.value); if (p) target.size = p; else target.unreadProps.push(prop); break; }
      case "Visible": { const b = bool(e.value); if (b !== null) target.visible = b; else target.unreadProps.push(prop); break; }
      case "Enabled": { const b = bool(e.value); if (b !== null) target.enabled = b; else target.unreadProps.push(prop); break; }
      case "TabIndex": { const n = int(e.value); if (n !== null) target.tabIndex = n; else target.unreadProps.push(prop); break; }
      default: break;
    }
    summary.applied += 1;
  }
  // `Items`, `Items1`, `Items2` are one list in index order; a list the designer already filled inline keeps its own.
  for (const [owner, list] of itemsBy) {
    const c = controls.get(owner);
    if (c.items.length) { leave(owner, "Items"); continue; }
    c.items.push(...list.sort((a, b) => a.index - b.index).map((i) => i.value));
    c.resxItems = true;
    summary.applied += list.length;
  }
  read.resx = summary;
  return summary;
}
