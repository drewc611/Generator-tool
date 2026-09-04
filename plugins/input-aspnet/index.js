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

// The server controls with an exact HTML meaning. Anything else inside an
// item template is replaced with a span and named, never guessed at.
const CONTROL_TAGS = { label: "span", literal: "span", linkbutton: "button", button: "button", hyperlink: "a", image: "img" };

/**
 * A Repeater's ItemTemplate is a row template in everything but the
 * rendering, and <%# Eval("Name") %> is a field read. Both carry across, so
 * a data bound region becomes a screen instead of an inventory line. The
 * list's name is derived from the control's ID because the data source is
 * server side; the note says so.
 */
export function readItemTemplates(text, rel, note = () => {}) {
  const screens = [];
  for (const m of text.matchAll(/<asp:(Repeater|ListView|DataList)\b([^>]*)>([\s\S]*?)<\/asp:\1>/gi)) {
    const id = /ID\s*=\s*["'](\w+)["']/i.exec(m[2])?.[1];
    const item = /<ItemTemplate>([\s\S]*?)<\/ItemTemplate>/i.exec(m[3]);
    if (!id || !item) continue;
    const list = id.charAt(0).toLowerCase() + id.slice(1);

    const lower = (markup) => markup
      .replace(/<%#\s*(?:Eval|Bind)\(\s*["'](\w+)["']\s*\)\s*%>/g, "{{ item.$1 }}")
      .replace(/<%#([\s\S]*?)%>/g, (w, code) => {
        note(`${rel}: the binding expression \`<%#${code.trim()}%>\` is code behind logic, not a field read. It was removed; rewire it in the port.`);
        return "";
      })
      .replace(/<(\/?)asp:(\w+)([^>]*)>/gi, (w, close, control, attrs) => {
        const tag = CONTROL_TAGS[control.toLowerCase()];
        if (!tag) {
          note(`${rel}: <asp:${control}> inside a template has no HTML equivalent this reader knows. It became a span carrying its name.`);
          return close ? "</span>" : `<span data-was="asp:${control}">`;
        }
        if (close) return `</${tag}>`;
        const text = /Text\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
        const href = /NavigateUrl\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
        const inner = text ? lowerText(text) : "";
        const open = `<${tag}${href ? ` href="${href}"` : ""}>${inner}`;
        // A self closed server control still renders content, so it closes.
        return /\/\s*$/.test(attrs) ? `${open}</${tag}>` : open;
      });
    const lowerText = (value) => value.replace(/<%#\s*(?:Eval|Bind)\(\s*["'](\w+)["']\s*\)\s*%>/g, "{{ item.$1 }}");

    const empty = /<EmptyDataTemplate>([\s\S]*?)<\/EmptyDataTemplate>/i.exec(m[3]);
    const rows = `<ng-container ng-repeat="item in ${list}">${lower(item[1])}</ng-container>`;
    const template = empty
      ? `${rows}<ng-container ng-if="!${list} || !${list}.length">${lower(empty[1])}</ng-container>`
      : rows;
    note(`${rel}: the ${m[1]} \`${id}\` binds a server side data source the repository does not show. The port iterates \`${list}\`; wire that name to the real data.`);
    screens.push({
      selector: `aspnet-${id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`,
      className: id,
      file: rel,
      inputs: [list],
      outputs: [],
      template,
      templateOrigin: `the ${m[1]} ItemTemplate in ${rel}`,
      usesNgIf: Boolean(empty),
      usesNgFor: true,
      usesTwoWay: false,
      rxjs: [],
      readBy: "aspnet",
    });
  }
  return screens;
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
      const notes = [];
      let screens = 0;
      for (const page of pages) {
        const text = await readFile(page.path, "utf8").catch(() => "");
        if (!text) continue;
        const found = readPage(text, page.rel);
        if (found.controls.length) inventory.push({ page: page.rel, ...found });
        for (const screen of readItemTemplates(text, page.rel, (n) => notes.push(n))) {
          ctx.screens.push(screen);
          screens += 1;
        }
      }
      for (const n of new Set(notes)) ctx.unverified(n);
      if (screens) log.info(`${screens} data bound template(s) became screen(s)`);
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
