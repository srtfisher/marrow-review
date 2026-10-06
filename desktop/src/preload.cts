// CommonJS because a sandboxed preload cannot be an ES module.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('marrowDesktop', {
  notify: (notice: unknown) => ipcRenderer.send('marrow:notify', notice),
  savePasses: (passes: unknown) => ipcRenderer.send('marrow:passes', passes),
});
