#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { access } from "node:fs/promises";
import { Kernel } from "./core/kernel.js";
import { Policy, PolicyViolation } from "./core/policy.js";
import { createLogger, createContext } from "./core/context.js";

const here = dirname(fileURLToPath(import.meta.url));
const BUILTIN = resolve(here, "../plugins");

const HELP = `
portamp  port a legacy front end, without losing the look or the API contract

usage
  portamp run [options]        run the pipeline
  portamp plugins              list what is loaded
  portamp init                 write a starter portamp.config.js
  portamp ui                   serve the last run at 127.0.0.1:4321

options
  --src <dir>          legacy source tree            (default ./legacy)
  --shots <dir>        screenshots of the old app    (default ./screenshots)
  --artifacts <dir>    HAR, schema dumps, exports    (default ./artifacts)
  --out <dir>          where the port is written     (default ./out)
  --only <names>       comma separated plugin names to run
  --allow-live         permit calls to real systems  (off by default)
  --allow-billable     permit calls that charge per request
      --port <n>       port for the ui command      (default 4321)
      --fresh          make ui run the pipeline again
  -v, --verbose        show plugin timings
  -q, --quiet          errors only
  -h, --help

plugin options
  Any option the core does not recognise is passed to the plugins untouched,
  so a target is turned on by naming it. Run "portamp plugins" to see what is
  loaded, and read each plugin's header for the option it answers to.

no source available
  Put a HAR, a schema dump, or report exports in ./artifacts, or configure
  record in portamp.config.js to drive the running app with Playwright.
  Both paths require portamp.authorization.json naming who owns the system.

policy
  Live calls are off unless you ask for them. Credentials found in the legacy
  source stop the run and are never copied into the port or printed.
`;

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "-h" || t === "--help") a.help = true;
    else if (t === "-v" || t === "--verbose") a.verbose = true;
    else if (t === "-q" || t === "--quiet") a.quiet = true;
    else if (t === "--allow-live") a.allowLive = true;
    else if (t === "--allow-billable") a.allowBillable = true;
    else if (t === "--fresh") a.fresh = true;
    else if (t.startsWith("--")) a[t.slice(2)] = argv[++i];
    else a._.push(t);
  }
  return a;
}

async function loadConfig(cwd) {
  const p = join(cwd, "portamp.config.js");
  try {
    await access(p);
    const mod = await import(`file://${p}`);
    return mod.default ?? {};
  } catch {
    return {};
  }
}

const CONFIG_TEMPLATE = `export default {
  src: "./legacy",
  shots: "./screenshots",
  out: "./out",

  // Anything in ./plugins is picked up automatically. List extra ones here.
  plugins: [],

  // Emitted design tokens override whatever the extractor infers.
  tokens: {},

  // Off by default. Turning these on is a statement that you are authorized.
  allowLive: false,
  allowBillable: false,
};
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || "run";
  if (args.help || cmd === "help") return process.stdout.write(HELP);

  const log = createLogger({ verbose: args.verbose, quiet: args.quiet });
  const cwd = process.cwd();

  if (cmd === "init") {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(cwd, "portamp.config.js"), CONFIG_TEMPLATE, "utf8");
    return log.info("wrote portamp.config.js");
  }

  const fileConfig = await loadConfig(cwd);

  // An option the core does not recognise belongs to a plugin, so it is passed
  // through rather than rejected. The core still learns nothing: it does not
  // know which plugin asked for it, or that any plugin did.
  const { _: _positional, ...flags } = args;

  const config = {
    // Everything from the config file passes through untouched, so a plugin
    // can read its own settings without the core learning that it exists. The
    // keys below are the ones the core itself resolves to absolute paths.
    ...fileConfig,
    ...flags,
    src: resolve(cwd, args.src || fileConfig.src || "./legacy"),
    shots: resolve(cwd, args.shots || fileConfig.shots || "./screenshots"),
    out: resolve(cwd, args.out || fileConfig.out || "./out"),
    tokens: fileConfig.tokens || {},
    artifacts: resolve(cwd, args.artifacts || fileConfig.artifacts || "./artifacts"),
    record: fileConfig.record || null,
    only: args.only ? args.only.split(",").map((s) => s.trim()) : null,
  };

  // The attestation may scope live calls to the domains it names. Read here
  // because the policy object is immutable once built; the plugin that
  // validates the attestation's content still runs at scan.
  let allowedDomains = null;
  try {
    const { readFile } = await import("node:fs/promises");
    const att = JSON.parse(await readFile(join(cwd, "portamp.authorization.json"), "utf8"));
    if (Array.isArray(att.domains)) allowedDomains = att.domains;
  } catch { /* no attestation, no domain scope */ }

  const policy = new Policy({
    allowLive: args.allowLive ?? fileConfig.allowLive ?? false,
    allowBillable: args.allowBillable ?? fileConfig.allowBillable ?? false,
    allowedDomains,
    log,
  });

  const kernel = new Kernel({ log, policy });
  await kernel.discover({
    builtinDir: BUILTIN,
    projectDir: join(cwd, "plugins"),
    extra: fileConfig.plugins || [],
  });

  // A command a plugin registered. The core dispatches it without knowing what
  // it is, the same way it dispatches a stage.
  const command = kernel.commands.get(cmd);
  if (command) {
    return command.run({
      config, log, policy, args,
      runPipeline: async () => {
        const ctx = createContext({ config, log, policy });
        await kernel.run(ctx);
        return ctx;
      },
    });
  }

  if (cmd === "plugins") {
    log.info(`\n${kernel.plugins.length} plugin(s)\n`);
    for (const p of kernel.plugins)
      log.info(`  ${p.class.padEnd(8)} ${p.name.padEnd(24)} ${p.version}`);
    if (kernel.commands.size) {
      log.info(`\n${kernel.commands.size} command(s) from plugins\n`);
      for (const [name, spec] of kernel.commands)
        log.info(`  portamp ${name.padEnd(22)} ${spec.describe ?? ""}  (${spec.plugin})`);
    }
    return;
  }

  if (config.only)
    kernel.bus.forEach((subs, stage) =>
      kernel.bus.set(
        stage,
        subs.filter((s) => config.only.includes(s.meta.name))
      )
    );

  const ctx = createContext({ config, log, policy });
  try {
    await kernel.run(ctx);
    log.info(
      `\ndone  ${ctx.written.length} file(s) written to ${config.out}` +
        (ctx.report.unverified.length
          ? `\n      ${ctx.report.unverified.length} item(s) could not be verified, see PORT_NOTES.md`
          : "")
    );
  } catch (err) {
    if (err instanceof PolicyViolation) {
      log.error(err.message);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
}

main().catch((e) => {
  process.stderr.write(`\x1b[31merror \x1b[0m${e.stack || e.message}\n`);
  process.exitCode = 1;
});
