import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { kindOf, lowerDialog, lowerMenu } from "../input-exe/index.js";
import { decodeText, preprocess, readHeader, readScript } from "./rc.js";

/**
 * Reads Windows resource scripts, the source form of what input-exe reads
 * from a compiled executable. A Visual C++ or MFC project keeps its dialogs,
 * menus, string table and version block in an .rc file, its symbolic ids in
 * the resource.h beside it, and what the editor does not touch in an .rc2.
 * Every dialog and menu here is read into exactly the shape the binary reader
 * produces and lowered through the same two functions, so a dialog written as
 * a script and the same dialog compiled come out as one screen.
 *
 * What the script cannot say is named rather than guessed: a style name in no
 * table, an id in no header, a conditional the reader could not evaluate, an
 * accelerator the port does not carry, an icon or bitmap it does not copy.
 */

const SKIP = new Set(["node_modules", "dist", ".git", "coverage"]);
const RC = /\.rc2?$/i;
/** Headers and scripts the SDK and MFC ship; a script names them and no project tree carries them. */
const SDK = new Set(["afxres.h", "afxres.rc", "afxprint.rc", "afxribbon.rc", "afxolecl.rc", "afxolesv.rc", "afxdb.rc", "afxctl.rc", "windows.h", "winres.h", "winresrc.h", "winver.h", "winuser.h", "commctrl.h", "richedit.h", "verrsrc.h", "prsht.h", "dlgs.h"]);

const kebab = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A caption as DIALOGS.md spells it: the mnemonic ampersand gone, a doubled one literal, a trailing ellipsis or colon dropped. */
const plain = (text) => String(text ?? "").replace(/&(&?)/g, "$1").replace(/(\.\.\.|…|:)\s*$/, "").trim();
/** Text inside a markdown table cell: the backslash first, then the pipe, and a line break as a space. */
const cell = (text) => String(text).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const dlu = (c) => `${c.x}, ${c.y}, ${c.cx} × ${c.cy}`;
const idCell = (name, id) => (name && name !== String(id) ? `${name} (${id})` : String(id));

/**
 * The scan keeps a fixed set of extensions and .rc is not in it yet, so this reader walks the source itself, under
 * the scan's own skip rules, and takes the scan's entries first wherever it does have them so no file is read twice.
 */
async function walk(dir, root, out = []) {
  let entries = [];
  try { entries = await readdir(dir); } catch { return out; }
  for (const e of entries.sort()) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    const s = await stat(p).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) await walk(p, root, out);
    else if (RC.test(extname(e))) out.push({ path: p, rel: relative(root, p).split(sep).join("/") });
  }
  return out;
}

async function scriptFiles(ctx) {
  const fromScan = (ctx.sources?.files ?? []).filter((f) => RC.test(f.rel));
  const seen = new Set(fromScan.map((f) => f.rel.replace(/^\.\//, "")));
  const walked = ctx.config.src ? await walk(ctx.config.src, ctx.config.src) : [];
  return [...fromScan, ...walked.filter((f) => !seen.has(f.rel))];
}

function report(files) {
  const out = ["# Resources", "", "Every resource script read: each dialog's controls with class, kind, caption and rectangle in dialog units (x, y, width × height), as DIALOGS.md lays them out for a compiled executable, the menus as the trees they declare, the string table by symbolic and numeric id, the version block, and the accelerators, images and other resources named and not carried. A symbolic id is shown with the number resource.h gave it; one with no number is one no header beside the script defined.", ""];
  for (const f of files) {
    const r = f.read;
    out.push(`## ${f.rel}`, "");
    const named = Object.keys(r.version);
    if (named.length || Object.keys(r.fixedVersion).length) {
      out.push("| version field | value |", "| --- | --- |");
      for (const [k, v] of Object.entries(r.fixedVersion)) out.push(`| ${k} (fixed) | ${cell(v)} |`);
      for (const k of named) out.push(`| ${k} | ${cell(r.version[k])} |`);
      out.push("");
    }
    if (!r.dialogs.length) out.push("No dialog templates.", "");
    for (const d of r.dialogs) {
      out.push(`### ${plain(d.title) || `dialog ${d.name}`} (${idCell(d.name, d.id)}${d.ex ? ", DIALOGEX" : ", DIALOG"}, line ${d.line})`, "",
        `${d.cx} × ${d.cy} dialog units${d.font ? `, font ${d.font.face} ${d.font.size}pt` : ""}, ${d.controls.length} control(s), style ${d.styles}${d.menu !== null ? `, menu ${d.menu}` : ""}.`, "",
        "| id | class | kind | caption | rectangle | style as written |", "| --- | --- | --- | --- | --- | --- |",
        ...d.controls.map((c) => `| ${cell(idCell(c.name, c.id))} | ${cell(c.className)} | ${kindOf(c)} | ${cell(plain(c.caption))} | ${dlu(c)} | ${cell(c.styles || "(default)")} |`), "");
    }
    const walkMenu = (items, depth) => items.flatMap((it) => it.separator ? [`${"  ".repeat(depth)}- ———`] : [`${"  ".repeat(depth)}- ${plain(it.text)}${it.children ? "" : ` (${idCell(it.name, it.id)})`}${it.disabled ? " disabled" : ""}${it.checked ? " checked" : ""}`, ...(it.children ? walkMenu(it.children, depth + 1) : [])]);
    for (const m of r.menus) {
      out.push(`### menu ${idCell(m.name, m.id)}${m.ex ? " (MENUEX)" : ""}, line ${m.line}`, "", ...walkMenu(m.items, 0), "");
      if (m.accelerators.length) out.push(`Accelerator text on ${m.accelerators.length} item(s), not carried: ${m.accelerators.map((a) => `${plain(a.item)} ${a.key}`).join("; ")}.`, "");
    }
    if (r.strings.length) out.push("### string table", "", "| id | value | text |", "| --- | --- | --- |", ...r.strings.map((s) => `| ${cell(s.name ?? s.id)} | ${s.name ? cell(s.id) : ""} | ${cell(s.text)} |`), "");
    for (const t of r.accelerators) out.push(`### accelerators ${idCell(t.name, t.id)}, line ${t.line}`, "", "Key bindings the port does not carry.", "", "| key | command |", "| --- | --- |", ...t.entries.map((e) => `| ${cell(e.key)} | ${cell(idCell(e.command, e.id))} |`), "");
    if (r.images.length) out.push("### images, not carried", "", "| kind | id | file |", "| --- | --- | --- |", ...r.images.map((i) => `| ${i.kind} | ${cell(idCell(i.name, i.id))} | ${cell(i.file)} |`), "");
    if (r.others.length) out.push("### other resources, not read", "", ...r.others.map((o) => `- ${o.type} ${o.name}${o.file ? ` (${o.file})` : ""}, line ${o.line}`), "");
    if (r.unevaluated.length) out.push("### conditions not evaluated", "", ...r.unevaluated.map((u) => `- line ${u.n}: \`${u.source}\`, first branch read${u.elseSkipped ? ", #else branch skipped" : ""}`), "");
    if (r.unresolved.size) out.push(`Ids no header defined, kept by name: ${[...r.unresolved].sort().join(", ")}.`, "");
    if (r.unknownStyles.size) out.push(`Style names in no table, contributing no bits: ${[...r.unknownStyles].sort().join(", ")}.`, "");
  }
  return out.join("\n") + "\n";
}

export default {
  name: "input-rc",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = await scriptFiles(ctx);
      if (!files.length) return log.debug("no resource scripts");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };
      const headerCache = new Map();
      const header = async (path) => {
        if (!headerCache.has(path)) headerCache.set(path, await readFile(path).then((bytes) => decodeText(bytes).text ?? null).then((t) => (t === null ? null : readHeader(t))).catch(() => null));
        return headerCache.get(path);
      };
      // An .rc2 is compiled inside the .rc that includes it, so it reads the includer's symbols; the .rc files go first.
      const ordered = [...files.filter((f) => !/\.rc2$/i.test(f.rel)), ...files.filter((f) => /\.rc2$/i.test(f.rel))];
      const symbolsByPath = new Map();
      const includedBy = new Map();
      let dialogs = 0;
      let menus = 0;
      for (const file of ordered) {
        const bytes = await readFile(file.path).catch(() => null);
        const rel = file.rel.replace(/^\.\//, "");
        if (bytes === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); continue; }
        const decoded = decodeText(bytes);
        if (decoded.error) { ctx.unverified(`${rel}: ${decoded.error}; nothing was read from it.`); continue; }
        const text = decoded.text;
        const dir = dirname(file.path);
        // The headers: every #include the script names that exists beside it, and resource.h beside it whether named or not.
        const { includes } = preprocess(text);
        const headers = [];
        const missing = [];
        const paths = includes.map((inc) => ({ inc, path: resolve(dir, inc.file.replace(/\\/g, "/")) }));
        for (const { inc, path } of paths) {
          const defines = /\.h$/i.test(path) ? await header(path) : null;
          if (defines) headers.push(defines);
          else if (/\.rc2?$/i.test(path)) { if (!includedBy.has(path)) includedBy.set(path, file.path); }
          else if (!SDK.has(inc.file.split(/[\\/]/).pop().toLowerCase())) missing.push(inc.file);
        }
        const beside = resolve(dir, "resource.h");
        if (!paths.some((p) => p.path === beside)) { const d = await header(beside); if (d) headers.push(d); }
        const inherited = includedBy.has(resolve(file.path)) ? [...symbolsByPath.get(includedBy.get(resolve(file.path))) ?? []] : [];
        const read = readScript(text, { headers, inherited });
        // What an included .rc2 inherits is everything its includer resolved names through: the headers and its own defines.
        symbolsByPath.set(file.path, [...headers.flat(), ...read.defines]);
        for (const m of missing) ctx.unverified(`${rel}: #include "${m}" was not found beside the script; the ids it defines stay unresolved.`);
        for (const p of [...new Set(read.problems)]) ctx.unverified(`${rel}: ${p}.`);
        for (const u of read.unevaluated) ctx.unverified(`${rel}, line ${u.n}: \`${u.source}\` was not evaluated (the name is neither defined in the script nor one the compiler always sets); the first branch was read${u.elseSkipped ? " and the #else branch skipped" : ""}.`);
        if (read.unresolved.size) ctx.unverified(`${rel}: id(s) ${[...read.unresolved].sort().join(", ")} are defined in no header beside the script; each keeps its name and the port cannot match it to a compiled template.`);
        if (read.unknownStyles.size) ctx.unverified(`${rel}: style name(s) ${[...read.unknownStyles].sort().join(", ")} are in no table this reader has; each contributed no bits, so a control they hid or disabled reads as shown and enabled.`);
        const product = read.version.ProductName ?? null;
        for (const d of read.dialogs) {
          const lowered = lowerDialog(d, (n) => ctx.unverified(`${rel}, dialog ${d.name} (line ${d.line}): ${n}`));
          const selector = unique(`dialog-${kebab(lowered.title) || kebab(String(d.id)) || "dialog"}`);
          ctx.screens.push({
            selector, className: pascal(selector), file: rel,
            // A field is the dialog's own state, not something it is handed.
            inputs: readInputs(lowered.template, { skip: lowered.fields }), outputs: lowered.outputs, template: lowered.template,
            templateOrigin: `dialog ${d.name}${d.name !== String(d.id) ? ` (${d.id})` : ""} in ${rel}, read from its resource script at line ${d.line}`,
            usesNgIf: lowered.usesNgIf, usesNgFor: lowered.usesNgFor, usesTwoWay: lowered.usesTwoWay, rxjs: [],
            readBy: "rc", title: lowered.title || `${product ?? rel} dialog ${d.name}`,
          });
          dialogs += 1;
        }
        for (const m of read.menus) {
          const lowered = lowerMenu(m);
          const selector = unique(`menu-${typeof m.id === "number" ? m.id : kebab(m.name)}`);
          ctx.screens.push({
            selector, className: pascal(selector), file: rel,
            inputs: [], outputs: lowered.outputs, template: lowered.template,
            templateOrigin: `menu ${m.name}${m.name !== String(m.id) ? ` (${m.id})` : ""} in ${rel}, read from its resource script at line ${m.line}`,
            usesNgIf: false, usesNgFor: false, usesTwoWay: false, rxjs: [], readBy: "rc", title: `${product ?? rel} menu ${m.name}`,
          });
          if (m.accelerators.length) ctx.unverified(`${rel}, menu ${m.name}: ${m.accelerators.length} item(s) carry accelerator text (${m.accelerators.map((a) => `${plain(a.item)}: ${a.key}`).join(", ")}); a key binding the port does not carry, so each command is reached by its menu button only.`);
          menus += 1;
        }
        for (const t of read.accelerators) ctx.unverified(`${rel}: the accelerator table ${t.name} binds ${t.entries.length} key(s) to commands (${t.entries.map((e) => `${e.key} → ${e.command}`).join(", ")}); key bindings the port does not carry.`);
        if (read.images.length) ctx.unverified(`${rel}: ${read.images.length} image resource(s) (${read.images.map((i) => `${i.kind} ${i.name}`).join(", ")}) are named in RESOURCES.md and not carried into the port.`);
        if (read.others.length) ctx.unverified(`${rel}: ${read.others.length} resource(s) of type(s) ${[...new Set(read.others.map((o) => o.type))].join(", ")} are not read; each is named in RESOURCES.md.`);
        if (read.strings.length) ctx.unverified(`${rel}: ${read.strings.length} string table entr(ies) are messages the code shows at runtime; RESOURCES.md lists them and the port has no place for them until the code that showed each is ported.`);
        seen.push({ rel, read });
      }
      if (seen.length) log.info(`${seen.length} resource script(s): ${dialogs} dialog(s) and ${menus} menu(s) read as screens`);
    });

    on("emit", async (ctx) => {
      if (!seen.length) return;
      await ctx.write("RESOURCES.md", report(seen));
      log.info("RESOURCES.md written");
    });
  },
};
