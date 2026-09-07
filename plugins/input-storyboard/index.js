import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { attrOf } from "../dsp-ir/markup.js";
import { parseStoryboard, scenesOf, seguesOf } from "./parse.js";
import { lowerScene } from "./lower.js";

/**
 * Reads Apple Interface Builder's `.storyboard` and `.xib` files, the
 * declarative XML UI format UIKit and AppKit apps have shared since Xcode 4,
 * still enormous in legacy iOS and macOS codebases. A `.xib` is one scene's
 * worth of the vocabulary with no navigation; a `.storyboard` wraps several
 * `<scene>` elements plus the `<segue>`s connecting them, so a scene is a
 * real screen boundary the way a Qt Designer form or a UNO dialog is, and a
 * multi scene storyboard produces one screen per scene. A button's
 * `<connections><action eventType="touchUpInside">` is the same event wiring
 * every other reader already names a handler for.
 *
 * What has no honest equivalent, an unrecognised control, a segmented
 * control filled from code, a button with no touchUpInside action, is named
 * through ctx.unverified rather than invented; a `<segue>` is real
 * navigation information and is named too, never wired, because routing
 * between scenes is out of scope for a single screen reader.
 * STORYBOARD.md gathers every file's own gaps and segues in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A class name's humps as hyphens: LoginViewController is login-view-controller, the selector spelling every other reader uses. */
const kebabClass = (name) => kebab(String(name ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

export default {
  name: "input-storyboard",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(storyboard|xib)$/i.test(f.rel));
      if (!files.length) return log.debug("no Interface Builder .storyboard or .xib files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "storyboard-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, scenes: [], segueNotes: [] }); continue; }

        const doc = parseStoryboard(text);
        if (!doc) { ctx.unverified(`${rel}: no <document> root element; nothing was read.`); seen.push({ rel, scenes: [], segueNotes: [] }); continue; }

        const entries = scenesOf(doc);
        if (!entries.length) { ctx.unverified(`${rel}: no scene found, storyboard or xib shaped; nothing was read.`); seen.push({ rel, scenes: [], segueNotes: [] }); continue; }

        const lowered = [];
        for (const { sceneId, objectsEl } of entries) {
          if (!objectsEl) { ctx.unverified(`${rel}${sceneId ? ` scene ${sceneId}` : ""}: <scene> declares no <objects>; nothing was read from it.`); continue; }
          const scene = lowerScene(objectsEl, sceneId, rel, (n) => ctx.unverified(n));
          if (scene) lowered.push(scene);
        }

        // Every segue in the file, resolved against the view controller ids this file's own scenes just named,
        // so a destination reads as the screen it targets when that screen is one this run read.
        const idToClassName = new Map(lowered.filter((s) => s.vcId).map((s) => [s.vcId, s.className]));
        const segueNotes = seguesOf(doc).map((seg) => {
          const identifier = attrOf(seg, "identifier");
          const destination = attrOf(seg, "destination");
          const target = (destination && idToClassName.get(destination)) || (destination ? `view controller id \`${destination}\`` : "an unnamed destination");
          return `segue \`${identifier || "(no identifier)"}\` navigates to ${target}.`;
        });
        for (const n of segueNotes) ctx.unverified(`${rel}: ${n}`);

        for (const scene of lowered) {
          const selector = unique(kebabClass(scene.className));
          ctx.screens.push({
            selector,
            className: pascal(selector),
            file: rel,
            inputs: readInputs(scene.template, { skip: scene.fields }),
            outputs: scene.outputs,
            template: scene.template,
            templateOrigin: `an Interface Builder ${/\.xib$/i.test(rel) ? "xib" : "storyboard"} scene, read structurally from ${rel}`,
            usesNgIf: false,
            usesNgFor: scene.usesNgFor,
            usesTwoWay: scene.usesTwoWay,
            rxjs: [],
            readBy: "storyboard",
            title: scene.title || scene.className,
          });
          screens += 1;
          for (const n of scene.notes) ctx.unverified(`${rel}: ${n}`);
        }
        seen.push({ rel, scenes: lowered, segueNotes });
      }

      if (!seen.length) return log.debug("no Interface Builder .storyboard or .xib files read");
      log.info(`${files.length} Interface Builder file(s): ${screens} screen(s) read from storyboards and xibs`);
      ctx.storyboard = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.storyboard?.length) return;
      await ctx.write("STORYBOARD.md", render(ctx.storyboard));
      log.info("STORYBOARD.md written");
    });
  },
};

function render(files) {
  const out = [
    "# Interface Builder scenes",
    "",
    "Every `.storyboard` and `.xib` file this run read, the scene or scenes",
    "Interface Builder wrote for it, and what became a screen. A control",
    "outside this reader's own vocabulary, a segmented control filled from",
    "code, and a button with no touchUpInside action wired are each named",
    "here rather than guessed. A `<segue>` is named as the navigation it is;",
    "none is wired, because routing between scenes is out of scope for a",
    "single screen reader.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.scenes.length) { out.push("Not read as a screen.", ""); continue; }
    out.push(`${f.scenes.length} scene(s) read.`, "");
    for (const scene of f.scenes) {
      out.push(`### ${scene.className}`, "");
      out.push(`${scene.fields.length} field(s), ${scene.outputs.length} output(s).`, "");
      if (scene.notes.length) out.push(...scene.notes.map((n) => `- ${n}`), "");
    }
    if (f.segueNotes.length) out.push("**Segues**", "", ...f.segueNotes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
