// Deliberately almost empty. The console is a served page that expects no
// privileged bridge, and a bridge it does not expect is attack surface.
//
// CommonJS on purpose: a sandboxed preload cannot load an ES module.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("portampDesktop", {
  openProject: () => ipcRenderer.invoke("open-project"),
});
