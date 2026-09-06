import { pixelDiff } from "./pixels.js";
import { pascal } from "../dsp-ir/emit.js";
import { buildIr } from "../dsp-ir/ir.js";

/**
 * The structure diff beside the pixel wipe: a moved div explains a changed
 * pixel. The recording's element list is compared against the IR of the
 * emitted screen, by tag counts and by the named interactive controls, and
 * the differences are said in words. Attributes are not compared; the
 * recording never carried them, and inventing a comparison would be a
 * verdict without evidence.
 */
export function diffStructure(recordedElements, ir) {
  const INTERACTIVE = new Set(["button", "a", "input", "select", "textarea"]);
  const recordedTags = new Map();
  const recordedControls = [];
  for (const el of recordedElements ?? []) {
    const tag = String(el.tag ?? "").toLowerCase();
    if (!tag) continue;
    recordedTags.set(tag, (recordedTags.get(tag) ?? 0) + 1);
    if (INTERACTIVE.has(tag) && el.name) recordedControls.push({ tag, name: String(el.name).trim() });
  }

  const portedTags = new Map();
  const portedControls = [];
  const textOf = (node) => (node.children ?? [])
    .flatMap((c) => (c.kind === "text" ? c.parts.filter((p) => p.literal !== undefined).map((p) => p.literal) : c.kind === "element" ? [textOf(c)] : []))
    .join(" ").replace(/\s+/g, " ").trim();
  const walk = (node) => {
    if (!node) return;
    if (node.kind === "element" && node.tag) {
      portedTags.set(node.tag, (portedTags.get(node.tag) ?? 0) + 1);
      if (INTERACTIVE.has(node.tag)) {
        const name = textOf(node);
        if (name) portedControls.push({ tag: node.tag, name });
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(ir?.root);

  const tagDrift = [];
  for (const tag of new Set([...recordedTags.keys(), ...portedTags.keys()])) {
    const was = recordedTags.get(tag) ?? 0;
    const is = portedTags.get(tag) ?? 0;
    if (was !== is) tagDrift.push({ tag, recorded: was, ported: is });
  }
  const missingControls = recordedControls.filter((r) => !portedControls.some((p) => p.tag === r.tag && p.name.toLowerCase().includes(r.name.toLowerCase())));
  return { tagDrift, missingControls, recordedControls: recordedControls.length };
}


/**
 * Writes the record of what was ported, what deviates, and what nobody could
 * verify. The last list is the point: the next person inherits the uncertainty
 * either way, so it may as well be written down.
 */
export default {
  name: "vis-parity",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    // Opt in with --pixels true. It needs playwright, an emitted element and
    // a real recording, and it degrades to a named skip when any is missing.
    on("verify", async (ctx) => {
      if (!ctx.config.pixels) return;
      const rows = [];
      for (const screen of ctx.screens) {
        const elementRel = `src/elements/${pascal(screen.selector) || "Screen"}.js`;
        if (!ctx.written.includes(elementRel)) {
          rows.push({ screen: screen.selector, skipped: "no element target was emitted (--html true adds one)" });
          continue;
        }
        const shot = ctx.sources.screenshots.find((x) => x.name.toLowerCase().includes(screen.selector.replace(/^app-/, "")));
        if (!shot) {
          rows.push({ screen: screen.selector, skipped: "no recording matches the screen" });
          continue;
        }
        const result = await pixelDiff({ outDir: ctx.config.out, elementRel, shotPath: shot.path });
        rows.push({ screen: screen.selector, shot: shot.name, ...result });
      }
      const measured = rows.filter((r) => r.pct !== undefined);
      log.info(measured.length ? `${measured.length} pixel diff(s) measured` : "pixel diff requested, nothing measurable");
      await ctx.write("PARITY_PIXELS.md", renderPixels(rows));
      for (const row of rows.filter((r) => r.skipped)) {
        ctx.unverified(`Pixel diff for ${row.screen} was skipped: ${row.skipped}.`);
      }
    });

    // The structure diff runs whenever a recording exists: no browser, no
    // flag, because comparing two lists of elements costs nothing and a
    // moved div explains a changed pixel better than a percentage does.
    on("verify", async (ctx) => {
      const exploration = ctx.sources.exploration;
      if (!exploration?.screens?.length || !ctx.model?.screens?.length) return;
      const slugOf = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      const rows = [];
      for (const rec of exploration.screens) {
        const named = ctx.model.screens.find((s) => s.id === rec.id);
        const screen = named ? ctx.screens.find((s) => s.selector === slugOf(named.name)) : null;
        if (!screen?.template) continue;
        let ir = null;
        try { ir = buildIr(screen.template); } catch { continue; }
        rows.push({ screen: screen.selector, ...diffStructure(rec.elements, ir) });
      }
      if (!rows.length) return;
      ctx.structureDiff = rows;
      const drifted = rows.filter((r) => r.tagDrift.length || r.missingControls.length);
      await ctx.write("PARITY_STRUCTURE.md", [
        "# Structure, recorded against ported",
        "",
        "The recording's element list against the IR of each ported screen: tag",
        "counts and the named interactive controls. A moved div explains a",
        "changed pixel; a missing button explains a complaint. Attributes are",
        "not compared, because the recording never carried them.",
        "",
        ...rows.flatMap((r) => [
          `## \`${r.screen}\``,
          "",
          r.tagDrift.length
            ? ["| tag | recorded | ported |", "| --- | --- | --- |", ...r.tagDrift.map((d) => `| \`${d.tag}\` | ${d.recorded} | ${d.ported} |`)].join("\n")
            : "Tag counts agree.",
          "",
          r.missingControls.length
            ? `Controls the recording shows and the port does not name: ${r.missingControls.map((c) => `\`<${c.tag}> ${c.name}\``).join(", ")}.`
            : `Every named control the recording shows (${r.recordedControls}) has a namesake in the port.`,
          "",
        ]),
      ].join("\n"));
      for (const r of drifted) {
        for (const c of r.missingControls) {
          ctx.unverified(`Structure: the recording shows a <${c.tag}> named ${JSON.stringify(c.name)} on ${r.screen} and the port does not; a control users had may be gone.`);
        }
      }
      log.info(`structure diff: ${rows.length} screen(s), ${drifted.length} with drift`);
    });

    on("verify", async (ctx) => {
      const shots = ctx.sources.screenshots;
      const rows = ctx.screens.map((s) => {
        const match = shots.find((x) => x.name.toLowerCase().includes(s.selector.replace(/^app-/, "")));
        return `| ${s.selector} | ${s.file} | ${match ? match.name : "no screenshot"} | ${match ? "compare" : "unmatched"} |`;
      });

      const md = [
        "# Port notes",
        "",
        `Generated ${new Date().toISOString().slice(0, 10)}. ${ctx.screens.length} component(s), ${ctx.api.calls.length} endpoint(s).`,
        "",
        "## Screens",
        "",
        "| Component | Source | Screenshot | Status |",
        "| --- | --- | --- | --- |",
        ...(rows.length ? rows : ["| none found | | | |"]),
        "",
        "## Endpoints",
        "",
        "| Name | Method | Path | From |",
        "| --- | --- | --- | --- |",
        ...(ctx.api.calls.length
          ? ctx.api.calls.map((c) => `| ${c.name} | ${c.method} | ${c.path} | ${c.file} |`)
          : ["| none found | | | |"]),
        "",
        "## Not verified",
        "",
        ...(ctx.report.unverified.length
          ? ctx.report.unverified.map((u) => `- ${u}`)
          : ["- Nothing outstanding."]),
        "",
        "## Deviations",
        "",
        ...(ctx.plan.notes.length ? ctx.plan.notes.map((n) => `- ${n}`) : ["- None recorded."]),
        "",
      ].join("\n");

      await ctx.write("PORT_NOTES.md", md);
      log.info(`parity report written, ${ctx.report.unverified.length} item(s) unverified`);
    });
  },
};

function renderPixels(rows) {
  return [
    "# Pixel difference, coarse on purpose",
    "",
    "The element target rendered live against the recording, both at the same",
    "width. Framing and data differences dominate this number, so it measures",
    "drift between runs, not fidelity; judge fidelity in the compare pane.",
    "",
    "| screen | recording | differing pixels |",
    "| --- | --- | --- |",
    ...rows.map((r) =>
      r.pct !== undefined
        ? `| \`${r.screen}\` | \`${r.shot}\` | ${r.pct}% of ${r.width}×${r.height} |`
        : `| \`${r.screen}\` | ${r.shot ? `\`${r.shot}\`` : "—"} | skipped: ${r.skipped} |`
    ),
    "",
  ].join("\n");
}
