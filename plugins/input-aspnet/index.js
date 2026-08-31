import { readFile } from "node:fs/promises";

/**
 * The WebForms reader. An .aspx page declares server controls, a code behind
 * owns the handlers, and ViewState carries a serialized copy of the page back
 * and forth on every postback. None of that renders in the repository, so
 * like the JSF reader this inventories the declarations and names what only a
 * running system can show.
 */

export function readPage(text, rel) {
  const controls = [];
  for (const m of text.matchAll(/<asp:(\w+)\b([^>]*)>/g)) {
    const id = /ID\s*=\s*["'](\w+)["']/i.exec(m[2]);
    const handler = /On(\w+)\s*=\s*["'](\w+)["']/.exec(m[2]);
    controls.push({ control: m[1], id: id?.[1] ?? null, handler: handler ? `${handler[1]} → ${handler[2]}` : null, file: rel });
  }
  const codeBehind = /CodeBehind\s*=\s*["']([^"']+)["']/i.exec(text)?.[1] ?? null;
  const viewState = /EnableViewState\s*=\s*["']false["']/i.test(text) ? "off" : "on (the default)";
  const postbacks = (text.match(/__doPostBack|AutoPostBack\s*=\s*["']true["']/gi) ?? []).length;
  return { controls, codeBehind, viewState, postbacks };
}

export default {
  name: "input-aspnet",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const pages = ctx.sources.files.filter((f) => /\.(aspx|ascx|master)$/.test(f.rel));
      if (!pages.length) return log.debug("no WebForms here");

      const inventory = [];
      for (const page of pages) {
        const text = await readFile(page.path, "utf8").catch(() => "");
        if (!text) continue;
        const found = readPage(text, page.rel);
        if (found.controls.length) inventory.push({ page: page.rel, ...found });
      }
      if (!inventory.length) return log.debug("pages, but no server controls");

      ctx.aspnet = inventory;
      log.info(`${inventory.length} page(s), ${inventory.reduce((a, p) => a + p.controls.length, 0)} server control(s)`);
      ctx.unverified(
        "WebForms pages declare their controls but the HTML, the postback cycle and everything ViewState " +
        "carried exist only at runtime. ASPNET.md holds the inventory; the rendered truth needs input-explore " +
        "against the running system, which needs an attestation."
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.aspnet) return;
      const sections = ctx.aspnet.map((p) => `### ${p.page}

Code behind: ${p.codeBehind ? `\`${p.codeBehind}\`` : "none declared"}. ViewState ${p.viewState}. ${p.postbacks} postback trigger(s).

| control | id | wired to |
| --- | --- | --- |
${p.controls.map((c) => `| asp:${c.control} | ${c.id ? `\`${c.id}\`` : "—"} | ${c.handler ?? "—"} |`).join("\n")}`);
      await ctx.write("ASPNET.md", `# The WebForms inventory

Each page's server controls and their handlers, read from the declarations.
A GridView here is a table screen in everything but rendering; a postback is a
whole page round trip the port will replace with a request. What ViewState
actually carried, only the running system can say.

${sections.join("\n\n")}
`);
    });
  },
};
