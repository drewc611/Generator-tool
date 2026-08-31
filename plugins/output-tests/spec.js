/**
 * A conformance suite written from what the legacy app actually did.
 *
 * Every codemod hands you code. None of them hands you a way to find out
 * whether the thing you now have still behaves like the thing you replaced.
 * The exploration already walked the old app and wrote down what each action
 * did: which screen it opened, which request it fired, what the app said when
 * it refused. That is a test suite, and this turns it into one.
 *
 * The suite is generated against the port, not the original, so it fails when
 * the port diverges. A step nobody exercised produces no test, which is why the
 * header says how much of the app the exploration actually reached.
 */

const quote = (text) => JSON.stringify(String(text ?? ""));

/** A selector from the old DOM is not a promise about the new one. */
function locatorFor(action, screens) {
  const screen = screens.find((s) => s.id === action.screen);
  const label = action.label?.trim();
  // What was clicked is in the selector. The label only says what it read as,
  // and a row's label is whatever record happened to be in it.
  const isRow = Boolean(screen?.collection) && /\b(tr|li)\b|:nth-of-type/.test(action.selector ?? "");

  if (isRow) return { code: `page.locator("tbody tr, li").first()`, how: "the first row of the collection" };
  if (label && /[a-z]/i.test(label) && label.length < 40) {
    return {
      code: `page.getByRole("button", { name: ${quote(label)} }).or(page.getByText(${quote(label)}, { exact: true })).first()`,
      how: "its visible label",
    };
  }
  // A control whose only name is a glyph cannot be found by name, which is
  // itself a finding: dsp-improve reports it and the port should fix it.
  return {
    code: `page.locator(${quote(action.selector)})`,
    how: "the selector it had in the original, because it has no accessible name. The port should give it one",
  };
}

export function buildSpec(model, exploration, { portUrl = "http://127.0.0.1:3000" } = {}) {
  const steps = (exploration.steps ?? []).filter((s) => s.changed || s.requests?.length || s.messages?.length);
  const screens = exploration.screens ?? [];
  const seen = new Set();
  const cases = [];

  for (const step of steps) {
    const action = { screen: step.from, label: step.action.label, selector: step.action.selector, kind: step.action.kind };
    const key = `${step.from}|${action.selector}|${step.action.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const locator = locatorFor(action, screens);
    const to = model.screens.find((s) => s.id === step.to);
    // dsp-behavior already reduced the page blob to the sentence the app
    // actually said. Asserting the blob asserts the whole screen.
    const raw = (step.messages ?? []).find((m) => /\b(required|must be|invalid|cannot be|already exists)\b/i.test(m));
    const fromScreen = model.screens.find((s) => s.id === step.from);
    const rule = raw
      ? (fromScreen?.fields ?? []).map((f) => f.validation).find((v) => v && raw.includes(v)) ?? null
      : null;
    const requests = (step.requests ?? []).filter((r) => r.path && !/\.(html?|css|js|png|svg|ico|woff2?)$/i.test(r.path));

    const body = [];
    body.push(`    await page.goto(base);`);

    // A control three screens in is not on the home screen. The exploration
    // recorded how it got there, so the test walks the same way.
    for (const earlier of step.path ?? []) {
      const via = locatorFor({ screen: step.from, label: earlier.label, selector: earlier.selector }, screens);
      body.push(
        earlier.kind === "fill"
          ? `    await ${via.code}.fill(${quote(earlier.value ?? "Test value")});`
          : `    await ${via.code}.click();`
      );
    }
    if ((step.path ?? []).length) body.push(``);

    // The wait has to be armed before the action or the request has already
    // gone by the time anybody listens for it.
    if (requests.length) {
      const r = requests[0];
      body.push(
        `    // The original fired this. A port that renders the same screen`,
        `    // without asking the server is not the same screen.`,
        `    const fired = page.waitForRequest(`,
        `      (candidate) => candidate.method() === ${quote(r.method)} && ${pathMatcher(r.path, model)},`,
        `      { timeout: 5000 },`,
        `    );`,
        ``
      );
    }

    if (step.action.kind === "fill") {
      body.push(`    await ${locator.code}.fill(${quote(step.action.value ?? "Test value")});`);
    } else {
      body.push(`    await ${locator.code}.click();`);
    }

    if (requests.length) {
      body.push(``, `    expect((await fired).method()).toBe(${quote(requests[0].method)});`);
    }

    if (rule) {
      body.push(
        ``,
        `    // The original refused, in these words. A port that accepts this`,
        `    // input has lost a rule nobody wrote down anywhere else.`,
        `    await expect(page.getByText(${quote(rule)}, { exact: false })).toBeVisible();`
      );
    } else if (step.changed && to) {
      // A screen named after a section id is not text anybody can see. Only a
      // heading the original actually rendered is safe to assert on.
      const arrived = screens.find((s) => s.id === step.to);
      const heading = (arrived?.headings ?? [])[0];
      const marker = heading && /[a-z]/i.test(heading) ? heading.replace(/\b[A-Za-z]{1,4}[-_]?\d{2,}\b/g, "").trim() : null;
      if (marker) {
        // It came from a heading, so assert the heading. The same words are
        // often on the button that opened the screen, and that button is
        // usually hidden by the time the screen is showing.
        body.push(
          ``,
          `    await expect(page.getByRole("heading", { name: ${quote(marker)} })).toBeVisible();`
        );
      }
      if (to.collection?.columns?.length) {
        // A column name is rarely unique on the page: "Customer" is a heading
        // and a field label at once. That the collection came back at all is
        // the thing worth asserting, and it survives a redesign.
        body.push(
          ``,
          `    // The original showed ${to.collection.rows} row(s) here, in columns:`,
          `    // ${to.collection.columns.join(", ")}`,
          `    await expect(page.locator("table tbody tr, ul li, ol li").first()).toBeVisible();`
        );
      }
    }

    if (!/expect\(/.test(body.join("\n"))) continue;
    cases.push({
      title: describe(step, locator),
      body: body.join("\n"),
      how: locator.how,
    });
  }

  return { cases, header: header(exploration, portUrl, cases.length), portUrl };
}

function pathMatcher(path, model) {
  const endpoint = (model.endpoints ?? []).find(
    (e) => e.path === path || (e.params.length && sameShape(e.path, path))
  );
  if (endpoint?.params.length) {
    const pattern = endpoint.path.replace(/:[\w]+/g, "[^/]+").replace(/\//g, "\\/");
    return `new RegExp(${quote(pattern)}).test(new URL(candidate.url()).pathname)`;
  }
  return `new URL(candidate.url()).pathname === ${quote(path)}`;
}

function sameShape(pattern, path) {
  const a = pattern.split("/");
  const b = path.split("/");
  return a.length === b.length && a.every((seg, i) => seg.startsWith(":") || seg === b[i]);
}

function describe(step, locator) {
  const what = step.action.kind === "fill" ? "filling" : "clicking";
  const label = step.action.label?.trim() || step.action.selector;
  return `${what} ${label.slice(0, 40)} does what it did in the original`;
}

function header(exploration, portUrl, count) {
  const performed = exploration.budget?.performed ?? (exploration.steps ?? []).length;
  const budget = exploration.budget?.maxSteps ?? performed;
  return `import { test, expect } from "@playwright/test";

/**
 * Conformance, generated by portamp from an exploration of
 *   ${exploration.baseUrl}
 * recorded ${exploration.recordedAt ?? "at an unknown time"}.
 *
 * Every assertion below is something the ORIGINAL did. These tests run against
 * the PORT, so a failure means the port diverged, not that the test is wrong.
 *
 * ${count} case(s), from ${performed} of ${budget} steps the explorer was allowed.
 * Anything the exploration never reached is not covered here, and the gap is
 * the size of the difference between those two numbers.
 *
 * Point it at the port:
 *   PORTAMP_PORT_URL=http://localhost:5173 npx playwright test
 */

const base = process.env.PORTAMP_PORT_URL ?? ${quote(portUrl)};
`;
}

export function renderSpec(spec) {
  if (!spec.cases.length) {
    return spec.header + `
test.skip("nothing was exercised, so nothing is asserted", () => {});
`;
  }
  return (
    spec.header +
    spec.cases
      .map((c) => `\ntest(${quote(c.title)}, async ({ page }) => {\n    // Located by ${c.how}.\n${c.body}\n});\n`)
      .join("")
  );
}
