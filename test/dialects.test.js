import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT, runPipeline } from "./helpers.js";

/**
 * The same page written in jinja, Twig, Liquid, Blade, FreeMarker, Velocity, Thymeleaf, Smarty, JSP, CFML and Haml produces one React
 * component, one Vue component and one Svelte component, byte for byte, once
 * the two provenance lines that name the source file and its dialect are set
 * aside. That is the only honest way to claim the middle is dialect blind: a
 * comparison that fails out loud rather than a promise.
 */

const DIALECTS = ["jinja", "twig", "liquid", "blade", "freemarker", "velocity", "thymeleaf", "smarty", "jsp", "cfml", "haml"];
const PROVENANCE = /^.*(Ported from|Template translated from|<!-- (Ported|Translated)|Source: ).*$\n?/gm;
const strip = (text) => text.replace(PROVENANCE, "");

test("one page in eleven server dialects is one component in each target, provenance lines aside", async () => {
  const outputs = new Map();
  for (const dialect of DIALECTS) {
    const run = await runPipeline({ src: join(ROOT, "test/fixtures/dialects", dialect), vue: true, svelte: true });
    try {
      assert.equal(run.error, null, `${dialect} runs`);
      const product = run.ctx.screens.find((s) => s.selector === "product");
      assert.ok(product, `${dialect} reads product as a screen`);
      assert.equal(product.readBy, dialect === "jinja" ? "jinja" : dialect, `${dialect} is read by its own reader`);
      const files = {};
      for (const f of ["src/features/Product/Product.jsx", "src/features/Product/Product.vue", "src/features/Product/Product.svelte"]) {
        files[f] = await readFile(join(run.out, f), "utf8");
      }
      outputs.set(dialect, files);
    } finally {
      await run.cleanup();
    }
  }
  const reference = outputs.get("jinja");
  for (const dialect of DIALECTS.slice(1)) {
    for (const [file, text] of Object.entries(outputs.get(dialect))) {
      assert.equal(strip(text), strip(reference[file]), `${file} from ${dialect} is byte identical to the one from jinja`);
      assert.notEqual(text, reference[file], `${file} still names the ${dialect} source it came from`);
    }
  }
  assert.match(reference["src/features/Product/Product.jsx"], /product\.tags\.map\(/, "the loop survived into every target");
});
