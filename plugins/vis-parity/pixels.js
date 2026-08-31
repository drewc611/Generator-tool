import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The pixel diff, finally written, with its limits printed beside it. The
 * dependency free element renders in a real browser next to the recording,
 * both are drawn at the same width, and the number is the share of pixels
 * that differ meaningfully. Framing and data differences dominate that
 * number, so it is a coarse instrument for "did the port drift", not a
 * verdict on fidelity; the compare pane is where judgment happens.
 *
 * Playwright is optional, imported lazily, and everything renders from
 * inlined local sources: no server is started and no request leaves the
 * machine.
 */

async function loadChromium() {
  try {
    const playwright = await import("playwright");
    return playwright.chromium;
  } catch {
    return null;
  }
}

/** The element and its runtime as one inline module, imports resolved by hand. */
async function inlineElement(outDir, elementRel) {
  const element = await readFile(join(outDir, elementRel), "utf8");
  const runtime = await readFile(join(outDir, "src/elements/runtime.js"), "utf8").catch(() => "");
  return runtime.replace(/^export /gm, "") + "\n" + element.replace(/^import[^\n]*from "\.\/runtime\.js";\n?/m, "");
}

export async function pixelDiff({ outDir, elementRel, shotPath }) {
  const chromium = await loadChromium();
  if (!chromium) return { skipped: "playwright is not installed; the diff needs a browser to render the element" };

  const shot = await readFile(shotPath).catch(() => null);
  if (!shot || !shot.length) return { skipped: "the recorded screenshot is empty" };

  const source = await inlineElement(outDir, elementRel);
  const tag = /customElements\.define\(\s*["']([\w-]+)["']/.exec(source)?.[1];
  if (!tag) return { skipped: "the emitted file defines no custom element" };

  let browser;
  try {
    // PORTAMP_CHROMIUM points at a browser binary when playwright's own
    // download is absent, which is common on CI images that vendor one.
    const executablePath = process.env.PORTAMP_CHROMIUM || undefined;
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch (err) {
    return { skipped: `the browser would not launch (set PORTAMP_CHROMIUM to a chromium binary if one is vendored): ${String(err.message).split("\n")[0]}` };
  }
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<body style="margin:0;background:#fff"><${tag} id="el"></${tag}></body>`,
      { waitUntil: "domcontentloaded" }
    );
    await page.addScriptTag({ content: source, type: "module" });
    await page.waitForTimeout(150);
    const rendered = await page.locator("#el").screenshot().catch(() => null);
    if (!rendered) return { skipped: "the element rendered nothing measurable" };

    // Both images are decoded and compared inside the browser, which already
    // knows how to read a PNG; portamp keeps its zero dependencies.
    const result = await page.evaluate(
      async ([recordedB64, renderedB64]) => {
        const load = (b64) =>
          new Promise((ok, fail) => {
            const img = new Image();
            img.onload = () => ok(img);
            img.onerror = fail;
            img.src = "data:image/png;base64," + b64;
          });
        const [a, b] = await Promise.all([load(recordedB64), load(renderedB64)]);
        const width = Math.min(a.naturalWidth, b.naturalWidth, 800);
        const height = Math.min(
          Math.round(a.naturalHeight * (width / a.naturalWidth)),
          Math.round(b.naturalHeight * (width / b.naturalWidth))
        );
        if (!width || !height) return { skipped: "one image has no size" };
        const draw = (img) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          context.drawImage(img, 0, 0, width, Math.round(img.naturalHeight * (width / img.naturalWidth)));
          return context.getImageData(0, 0, width, height).data;
        };
        const pa = draw(a);
        const pb = draw(b);
        let different = 0;
        for (let i = 0; i < pa.length; i += 4) {
          const delta = Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
          if (delta > 48) different += 1;
        }
        return { pct: Math.round((different / (pa.length / 4)) * 1000) / 10, width, height };
      },
      [shot.toString("base64"), rendered.toString("base64")]
    );
    return result;
  } finally {
    await browser.close();
  }
}
