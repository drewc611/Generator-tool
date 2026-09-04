import { readFile } from "node:fs/promises";

/**
 * The JSF reader, for the apps whose markup is only half the story.
 *
 * A facelets page declares components (h:dataTable, h:inputText) bound to
 * managed beans by EL expressions, and the HTML a browser gets is produced
 * server side. So this reader inventories what the pages declare, and says
 * plainly that the rendered truth needs input-explore against the running
 * system: the repository does not contain what the user saw.
 */

const COMPONENT_KINDS = [
  { re: /<h:dataTable\b[^>]*value\s*=\s*["']#\{([^}]+)\}["']/g, kind: "table", meaning: "a collection screen over" },
  { re: /<(?:h|p):inputText\b[^>]*value\s*=\s*["']#\{([^}]+)\}["']/g, kind: "input", meaning: "a field bound to" },
  { re: /<h:selectOneMenu\b[^>]*value\s*=\s*["']#\{([^}]+)\}["']/g, kind: "select", meaning: "a choice bound to" },
  { re: /<(?:h|p):commandButton\b[^>]*action(?:Listener)?\s*=\s*["']#\{([^}]+)\}["']/g, kind: "action", meaning: "a button invoking" },
  { re: /<ui:repeat\b[^>]*value\s*=\s*["']#\{([^}]+)\}["']/g, kind: "repeat", meaning: "a repeated region over" },
];

export function readPage(text, rel) {
  const bindings = [];
  for (const { re, kind, meaning } of COMPONENT_KINDS) {
    for (const m of text.matchAll(re)) {
      bindings.push({ kind, meaning, expression: m[1], bean: m[1].split(".")[0], file: rel });
    }
  }
  const forms = (text.match(/<h:form\b/g) ?? []).length;
  const messages = /h:message[s]?\b/.test(text);
  return { bindings, forms, messages };
}

export default {
  name: "input-jsf",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const pages = ctx.sources.files.filter((f) => /\.(xhtml|jsf|jsp)$/.test(f.rel));
      if (!pages.length) return log.debug("no facelets here");

      const inventory = [];
      for (const page of pages) {
        const text = await readFile(page.path, "utf8").catch(() => "");
        if (!text) continue;
        const found = readPage(text, page.rel);
        if (found.bindings.length) inventory.push({ page: page.rel, ...found });
      }
      if (!inventory.length) return log.debug("pages, but nothing bound");

      ctx.jsf = inventory;
      const beans = new Set(inventory.flatMap((p) => p.bindings.map((b) => b.bean)));
      log.info(`${inventory.length} page(s), ${beans.size} managed bean(s) referenced`);
      ctx.unverified(
        `The JSF pages declare their components but the HTML the user saw was produced server side, and the ` +
        `repository does not contain it. JSF.md holds the inventory; for the rendered truth, drive the running ` +
        `system with input-explore, which needs an attestation.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.jsf) return;
      const sections = ctx.jsf.map((p) => `### ${p.page}

${p.forms} form(s)${p.messages ? ", renders validation messages" : ""}.

| declares | bound to |
| --- | --- |
${p.bindings.map((b) => `| ${b.kind} | \`#{${b.expression}}\` |`).join("\n")}`);
      await ctx.write("JSF.md", `# The facelets inventory

What each page declares, and which managed bean it leans on. The rendered
HTML, the request cycle and the state that ViewState carried are all server
side: this is the half of the app the repository contains, stated as exactly
that.

${sections.join("\n\n")}
`);
    });
  },
};
