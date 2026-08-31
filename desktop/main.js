import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The portamp console as a window.
 *
 * This is a shell and nothing more: the pipeline, the policy gates and the
 * server are the same code the CLI runs, imported from the repository that
 * ships inside the app. Nothing is forked, so the desktop app can never
 * disagree with the command line about what a run did.
 *
 * The server still binds 127.0.0.1 only. Putting a window in front of the
 * console does not change what it serves or to whom.
 */

const here = dirname(fileURLToPath(import.meta.url));
// Packaged, the repo sits in resources/portamp; in development it is the
// parent checkout. Both are the same code.
const ROOT = app.isPackaged ? join(process.resourcesPath, "portamp") : resolve(here, "..");

const load = (rel) => import(`file://${join(ROOT, rel)}`);

let window = null;
let ui = null;

async function runPipeline({ src, out }) {
  const [{ Kernel }, { Policy, PolicyViolation }, { createContext, createLogger }] = await Promise.all([
    load("src/core/kernel.js"), load("src/core/policy.js"), load("src/core/context.js"),
  ]);
  const log = createLogger({ quiet: true });
  const policy = new Policy({ log });
  const kernel = new Kernel({ log, policy });
  await kernel.discover({ builtinDir: join(ROOT, "plugins") });

  const config = {
    src, out,
    shots: join(src, "..", "screenshots"),
    artifacts: join(src, "..", "artifacts"),
    tokens: {}, record: null, only: null,
  };
  const ctx = createContext({ config, log, policy });
  try {
    await kernel.run(ctx);
    return { ok: true, written: ctx.written.length, unverified: ctx.report.unverified.length, config };
  } catch (error) {
    // A policy stop is a result the window should show, not a crash.
    if (error instanceof PolicyViolation) return { ok: false, policy: error.message, config };
    throw error;
  }
}

async function openProject() {
  const picked = await dialog.showOpenDialog(window, {
    title: "Choose the legacy app's source directory",
    properties: ["openDirectory"],
  });
  if (picked.canceled || !picked.filePaths.length) return;
  return openProjectPath(picked.filePaths[0]);
}

async function openProjectPath(src) {
  const out = join(app.getPath("userData"), "runs", Date.now().toString(36));

  window.loadURL(`data:text/html,<body style="background:%23101013;color:%233fbf7f;font-family:monospace;display:grid;place-content:center;height:100vh;margin:0">running the pipeline…</body>`);

  const result = await runPipeline({ src, out });
  if (!result.ok) {
    dialog.showErrorBox("The policy stopped the run", result.policy);
  }

  const { serve } = await load("plugins/vis-ui/index.js");
  if (ui) ui.server.close();
  ui = await serve({
    outDir: out,
    shotsDir: result.config.shots,
    port: 0,
    log: { info: () => {}, error: console.error },
    rerun: () => runPipeline({ src, out }),
  });
  // Written to stdout on purpose: it is how anything driving this window
  // headlessly, CI included, knows the console came up.
  console.log(`portamp console at ${ui.address}`);
  window.loadURL(ui.address);
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#101013",
    title: "portamp",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const menu = Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }] },
    {
      label: "File",
      submenu: [
        { label: "Open Legacy App…", accelerator: "CmdOrCtrl+O", click: openProject },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
  ]);
  Menu.setApplicationMenu(menu);

  window.loadURL(`data:text/html,<body style="background:%23101013;color:%23d7d7de;font-family:monospace;display:grid;place-content:center;height:100vh;margin:0;text-align:center"><div><div style="color:%23f0a830;letter-spacing:4px;font-weight:700">P O R T A M P</div><p style="color:%238b8b96">File → Open Legacy App… to point it at a source tree.</p></div></body>`);
}

ipcMain.handle("open-project", openProject);

app.whenReady().then(() => {
  createWindow();
  // `portamp --open ./legacy` skips the dialog, for scripts and for people
  // who know exactly which app they came to port.
  const flag = process.argv.indexOf("--open");
  if (flag > -1 && process.argv[flag + 1]) {
    openProjectPath(resolve(process.argv[flag + 1])).catch((err) => {
      console.error(err.message);
      app.exit(1);
    });
  }
});
app.on("window-all-closed", () => {
  if (ui) ui.server.close();
  app.quit();
});
