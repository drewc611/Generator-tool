import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { decodeJpeg } from "../input-shots/jpeg.js";
import { decodePng } from "../input-shots/png.js";
import { segment } from "./regions.js";

/**
 * A photograph of a screen, a sketch, a paper form or a whiteboard becomes a
 * component. The picture is decoded with the readers beside this one (PNG and
 * JPEG, a phone's orientation applied), cut into the regions a screen is made
 * of by shape alone, and lowered onto the same dialect every other reader
 * targets, each region kept where the picture had it as a share of the page,
 * so React, Vue and Svelte lay it out as photographed.
 *
 * No words are read. There is no OCR here and no model, so every line of
 * writing in the picture is an input the component takes, named by its role
 * (a title, a label, a caption, a line) and listed in PHOTO.md with where it
 * sits and how long it is, for a person to type in. Which box is a field and
 * which a button is read from shape, so it is a reading; the notes say so and
 * where the reading was least sure.
 *
 * With --photo true every picture in the screenshots folder is read; with
 * --photo <file or folder> that is read instead.
 */

const IMG = /\.(png|jpe?g)$/i;

const kebab = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pct = (v) => `${(v * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/** The box around two regions, in pixels and as a share of the page. */
const union = (a, b) => {
  const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y);
  const w = Math.max(a.x + a.w, b.x + b.w) - x; const h = Math.max(a.y + a.h, b.y + b.h) - y;
  return { x, y, w, h, at: { left: Math.min(a.at.left, b.at.left), top: Math.min(a.at.top, b.at.top), width: Math.max(a.at.left + a.at.width, b.at.left + b.at.width) - Math.min(a.at.left, b.at.left), height: Math.max(a.at.top + a.at.height, b.at.top + b.at.height) - Math.min(a.at.top, b.at.top) } };
};

/** A region's place as a style attribute, relative to the box that holds it. */
function place(r, parent) {
  const at = parent
    ? { left: (r.at.left - parent.at.left) / parent.at.width, top: (r.at.top - parent.at.top) / parent.at.height, width: r.at.width / parent.at.width, height: r.at.height / parent.at.height }
    : r.at;
  return `style="position:absolute;left:${pct(at.left)};top:${pct(at.top)};width:${pct(at.width)};height:${pct(at.height)}"`;
}

/**
 * Regions to a template on the shared dialect. Returns the template, the inputs each unread line became,
 * the fields (the component's own state), the outputs a button raises, and the notes the reading owes.
 */
export function lowerPhoto(read, { name, width, height }) {
  const counters = {};
  const unique = (base) => { counters[base] = (counters[base] ?? 0) + 1; return `${base}${counters[base]}`; };
  const words = [];
  const fields = [];
  const outputs = [];
  const notes = [];
  let titled = false;
  const word = (role, region, about) => {
    const id = unique(role);
    words.push({ name: id, role, glyphs: region.glyphs, x: region.x, y: region.y, w: region.w, h: region.h, about });
    return id;
  };
  const near = (a, b) => b && a.y + a.h <= b.y && b.y - (a.y + a.h) <= a.h * 2.2 && Math.abs(a.x - b.x) <= Math.max(a.w, b.w) * 0.5;
  const lines = [];
  const walk = (regions, parent, pad) => {
    for (let i = 0; i < regions.length; i += 1) {
      const r = regions[i];
      const at = place(r, parent);
      switch (r.kind) {
        case "text": {
          const next = regions[i + 1];
          // Writing just above a field, lined up with it, is the field's label.
          if (next && next.kind === "field" && near(r, next) && !next.labelled) {
            const field = unique("field");
            next.labelled = field;
            lines.push(`${pad}<label for="f-${kebab(field)}" ${at}>{{${word("label", r, `labels the field ${field}`)}}}</label>`);
          } else if (next && next.kind === "check" && Math.abs(next.y - r.y) <= r.h) {
            // Writing left of a check box captions it; the box comes next in reading order.
            const check = unique("check");
            fields.push(check);
            next.rendered = true;
            lines.push(`${pad}<label ${place(union(r, next), parent)}><input type="checkbox" ng-model="${check}"> {{${word("caption", r, `captions the check box ${check}`)}}}</label>`);
          } else lines.push(`${pad}<p ${at}>{{${word("line", r, "a line of writing")}}}</p>`);
          break;
        }
        case "field": {
          const field = r.labelled ?? unique("field");
          fields.push(field);
          const placeholder = r.label ? ` placeholder="{{${word("placeholder", r.label, `the writing inside the field ${field}`)}}}"` : "";
          const aria = r.labelled ? "" : ` aria-label="${field}"`;
          lines.push(`${pad}<input id="f-${kebab(field)}" type="text" ng-model="${field}"${placeholder}${aria} ${at}>`);
          break;
        }
        case "check": {
          if (r.rendered) break;
          const next = regions[i + 1];
          const check = unique("check");
          fields.push(check);
          if (next && next.kind === "text" && Math.abs(next.y - r.y) <= next.h) {
            next.rendered = true;
            i += 1;
            lines.push(`${pad}<label ${place(union(r, next), parent)}><input type="checkbox" ng-model="${check}"> {{${word("caption", next, `captions the check box ${check}`)}}}</label>`);
          } else lines.push(`${pad}<label ${at}><input type="checkbox" ng-model="${check}" aria-label="${check}"></label>`);
          break;
        }
        case "button": {
          const action = unique("action");
          outputs.push(action);
          const caption = word("caption", r.label, `the caption on the button that raises ${action}`);
          lines.push(`${pad}<button type="button" ng-click="on${pascal(action)}()" ${at}>{{${caption}}}</button>`);
          break;
        }
        case "bar": {
          if (r.label && !titled) { titled = true; lines.push(`${pad}<header ${at}><h1>{{${word("title", r.label, "the writing on the bar across the top")}}}</h1></header>`); }
          else if (r.label) lines.push(`${pad}<div class="bar" ${at}><p>{{${word("line", r.label, "the writing on a bar")}}}</p></div>`);
          else lines.push(`${pad}<div class="bar" ${at}></div>`);
          break;
        }
        case "card": {
          lines.push(`${pad}<section class="card" ${at}>`);
          walk(r.children ?? [], r, pad + "  ");
          lines.push(`${pad}</section>`);
          break;
        }
        case "image": lines.push(`${pad}<span class="image" role="img" aria-label="${unique("image")}" ${at}></span>`); break;
        case "mark": lines.push(`${pad}<span class="mark" role="img" aria-label="${unique("mark")}" ${at}></span>`); break;
        default: lines.push(`${pad}<div class="box" ${at}></div>`); break;
      }
    }
  };
  walk(read.regions, null, "  ");
  if (!read.regions.length) notes.push("nothing in the picture stood out from its background, so the screen is empty; a picture with more contrast would read");
  const template = [`<div class="photo-screen" style="position:relative;aspect-ratio:${width} / ${height}">`, ...lines, "</div>"].join("\n");
  return { template, words, fields, outputs, notes, name };
}

/** Decode a picture by its bytes: PNG by signature, JPEG otherwise. */
export function decodePicture(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return decodePng(bytes);
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return decodeJpeg(bytes);
  return { error: "neither a PNG nor a JPEG by its first bytes" };
}

/** The pictures the flag points at: a file, a folder, or with `true` the screenshots folder. */
export async function picturesFor(config) {
  const flag = config.photo;
  if (!flag) return [];
  const at = typeof flag === "string" && flag !== "true" ? resolve(process.cwd(), flag) : config.shots;
  const info = await stat(at).catch(() => null);
  if (!info) return [];
  if (info.isFile()) return IMG.test(at) ? [at] : [];
  const entries = await readdir(at).catch(() => []);
  return entries.filter((e) => IMG.test(e)).sort().map((e) => join(at, e));
}

export default {
  name: "input-photo",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const pictures = await picturesFor(ctx.config);
      if (!pictures.length) return log.debug(ctx.config.photo ? "no picture at the photo flag's path" : "no photo flag");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };
      for (const path of pictures) {
        const file = basename(path);
        const bytes = await readFile(path).catch(() => null);
        const image = bytes ? decodePicture(bytes) : { error: "unreadable" };
        if (image.error) { ctx.unverified(`${file}: ${image.error}; nothing was read from it.`); continue; }
        const read = segment(image);
        const name = basename(file, extname(file));
        const lowered = lowerPhoto(read, { name, width: image.width, height: image.height });
        const selector = unique(`photo-${kebab(name) || "screen"}`);
        for (const n of lowered.notes) ctx.unverified(`${file}: ${n}.`);
        if (lowered.words.length) {
          ctx.unverified(
            `${file}: ${lowered.words.length} line(s) of writing were placed and not read, because no words are read from a picture. ` +
              `Each is an input the component takes (${lowered.words.slice(0, 4).map((w) => w.name).join(", ")}${lowered.words.length > 4 ? ", …" : ""}); PHOTO.md says where each sits and how many marks long it is.`
          );
        }
        const kinds = count(read.regions);
        ctx.unverified(`${file}: which box is a field, a button or a card was read from shape alone (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")}); a control that looks like another is read as the other.`);
        ctx.screens.push({
          selector, className: pascal(selector), file,
          inputs: readInputs(lowered.template, { skip: lowered.fields }), outputs: lowered.outputs, template: lowered.template,
          templateOrigin: `${file}, ${image.width} × ${image.height} pixels, read by shape from its pixels`,
          usesNgIf: false, usesNgFor: false, usesTwoWay: lowered.fields.length > 0, rxjs: [],
          readBy: "photo", title: name,
        });
        seen.push({ file, image, read, lowered, selector });
      }
      if (seen.length) log.info(`${seen.length} picture(s) read as screens by shape; the words in them are inputs to fill`);
    });

    on("emit", async (ctx) => {
      if (!seen.length) return;
      const lines = ["# Photographed screens", "", "Each picture below was cut into regions by shape and became a component laid out as photographed. No words were read: every line of writing is an input the component takes, listed with where it sits (pixels from the top left) and how many marks long it is, so a person can type what it said. Which region is a field, a button or a card is a reading from shape, not a fact.", ""];
      for (const s of seen) {
        lines.push(`## ${s.file}`, "", `${s.image.width} × ${s.image.height} pixels, ${s.read.darkPage ? "a dark page with light marks" : "a light page with dark marks"}; the writing is about ${s.read.lineHeight} pixels tall. Component \`${s.selector}\`.`, "");
        lines.push("| region | at (x, y) | size | says |", "| --- | --- | --- | --- |");
        const rows = (regions, depth) => {
          for (const r of regions) {
            const said = r.kind === "text" ? "writing, not read" : r.label ? `${r.label.glyphs} mark(s) of writing on it, not read` : "";
            lines.push(`| ${"  ".repeat(depth)}${r.kind} | ${r.x}, ${r.y} | ${r.w} × ${r.h} | ${said} |`);
            if (r.children) rows(r.children, depth + 1);
          }
        };
        rows(s.read.regions, 0);
        lines.push("", "| input | role | at (x, y) | marks | about |", "| --- | --- | --- | --- | --- |");
        for (const w of s.lowered.words) lines.push(`| ${w.name} | ${w.role} | ${w.x}, ${w.y} | ${w.glyphs} | ${w.about} |`);
        if (s.lowered.fields.length) lines.push("", `Fields (the component's own state): ${s.lowered.fields.join(", ")}.`);
        if (s.lowered.outputs.length) lines.push(`Buttons (events the component raises): ${s.lowered.outputs.join(", ")}.`);
        lines.push("");
      }
      await ctx.write("PHOTO.md", lines.join("\n"));
      log.info(`PHOTO.md written for ${seen.length} picture(s)`);
    });
  },
};

const count = (regions) => {
  const out = {};
  const walk = (rs) => { for (const r of rs) { out[r.kind] = (out[r.kind] ?? 0) + 1; if (r.children) walk(r.children); } };
  walk(regions);
  return out;
};
