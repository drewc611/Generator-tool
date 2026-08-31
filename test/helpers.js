import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Kernel } from "../src/core/kernel.js";
import { Policy } from "../src/core/policy.js";
import { createContext, createLogger } from "../src/core/context.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BUILTIN = join(ROOT, "plugins");

/** Wire a run the way the CLI does, but quietly and into a temp directory. */
export async function runPipeline({
  src = join(ROOT, "example/legacy"),
  shots = join(ROOT, "example/screenshots"),
  artifacts = join(ROOT, "example/artifacts"),
  tokens = {},
  only = null,
  allowLive = false,
} = {}) {
  const out = await mkdtemp(join(tmpdir(), "portamp-"));
  const log = createLogger({ quiet: true });
  const policy = new Policy({ allowLive, log });
  const kernel = new Kernel({ log, policy });
  await kernel.discover({ builtinDir: BUILTIN, projectDir: null, extra: [] });

  if (only) {
    kernel.bus.forEach((subs, stage) =>
      kernel.bus.set(stage, subs.filter((s) => only.includes(s.meta.name)))
    );
  }

  const ctx = createContext({
    config: { src, shots, out, artifacts, tokens, record: null, only },
    log,
    policy,
  });

  try {
    await kernel.run(ctx);
    return { ctx, out, kernel, error: null, cleanup: () => rm(out, { recursive: true, force: true }) };
  } catch (error) {
    return { ctx, out, kernel, error, cleanup: () => rm(out, { recursive: true, force: true }) };
  }
}

export const quietLogger = () => createLogger({ quiet: true });
