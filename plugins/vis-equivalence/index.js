import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * Runs the emitted conformance suite against the port, and folds the verdict
 * back into the report. output-tests writes the claim; this is the half that
 * checks it, which is the difference between "a suite exists" and "the port
 * behaves like the thing it replaced".
 *
 *   equivalence: http://127.0.0.1:5173     (wherever the port is running)
 *
 * Loopback is the expected case. Anything else is a live system and goes
 * through the policy gate like every other network call in this tool.
 */

export function fold(results) {
  const specs = [];
  const walk = (suite) => {
    for (const inner of suite.suites ?? []) walk(inner);
    for (const spec of suite.specs ?? []) {
      const test = spec.tests?.[0];
      const status = test?.results?.at(-1)?.status ?? test?.status ?? "unknown";
      specs.push({
        title: spec.title,
        ok: status === "passed" || status === "expected",
        error: test?.results?.at(-1)?.error?.message?.split("\n")[0] ?? null,
      });
    }
  };
  for (const suite of results.suites ?? []) walk(suite);
  return {
    total: specs.length,
    passed: specs.filter((s) => s.ok).length,
    failures: specs.filter((s) => !s.ok),
  };
}

export default {
  name: "vis-equivalence",
  version: "0.1.0",
  class: "vis",
  setup({ on, log, policy }) {
    on("verify", async (ctx) => {
      const url = ctx.config.equivalence;
      const suite = ctx.written.find((f) => /conformance\.spec\.js$/.test(f));
      if (!url) return log.debug("no port url named; the suite stays unexecuted");
      if (!suite) {
        ctx.unverified("--equivalence was given but no conformance suite was emitted this run; there was no exploration to write one from.");
        return log.info("nothing to run");
      }

      if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url)) {
        policy.assertLiveAllowed(`running the conformance suite against ${url}`);
      }

      try {
        await import("@playwright/test");
      } catch {
        ctx.unverified(
          "The conformance suite could not run: @playwright/test is not installed. " +
          "npm install --no-save @playwright/test, then rerun with --equivalence."
        );
        return log.info("@playwright/test absent; said so");
      }

      const output = await new Promise((resolve) => {
        const child = spawn("npx", ["playwright", "test", suite, "--reporter=json"], {
          cwd: ctx.config.out,
          env: { ...process.env, PORTAMP_PORT_URL: url },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => { out += d; });
        child.stderr.on("data", (d) => { err += d; });
        child.on("close", () => resolve({ out, err }));
        child.on("error", (e) => resolve({ out: "", err: String(e) }));
      });

      let results;
      try {
        results = JSON.parse(output.out.slice(output.out.indexOf("{")));
      } catch {
        ctx.unverified(`The conformance run produced no readable result. Its stderr began: ${output.err.slice(0, 200)}`);
        return log.info("run unreadable; said so");
      }

      const verdict = fold(results);
      ctx.equivalence = verdict;
      log.info(`${verdict.passed}/${verdict.total} behaviours match the original`);

      for (const failure of verdict.failures) {
        ctx.report.parity.push({ what: failure.title, status: "diverged", note: failure.error ?? "failed" });
      }
      await ctx.write("EQUIVALENCE.md", render(verdict, url));
    });
  },
};

function render({ total, passed, failures }, url) {
  return `# Does the port behave like the thing it replaced

The conformance suite ran against ${url}. ${passed} of ${total} recorded
behaviours match.

${failures.length ? `## Where it diverges

${failures.map((f) => `- **${f.title}**${f.error ? `\n  ${f.error}` : ""}`).join("\n")}

A divergence is not automatically a defect: some are the improvements
IMPROVEMENTS.md proposed on purpose. But every one should be either a defect
being fixed or an improvement being claimed, and never a surprise.` : `Nothing diverges. Within what the exploration recorded, the port is the
same product.`}

The claim's size: the suite tests the ${total} behaviour(s) an exploration
actually saw. What it never did, this cannot certify.
`;
}
