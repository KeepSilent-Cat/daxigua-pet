"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/preload/preload.ts
var preload_exports = {};
module.exports = __toCommonJS(preload_exports);
var import_electron = require("electron");
function on(channel, cb) {
  import_electron.ipcRenderer.on(channel, (_e, payload) => cb(payload));
}
import_electron.contextBridge.exposeInMainWorld("pet", {
  getSkin: () => import_electron.ipcRenderer.invoke("skin:get"),
  getServices: () => import_electron.ipcRenderer.invoke("services:describe"),
  getDebugState: () => import_electron.ipcRenderer.invoke("pet:debug-state"),
  dragStart: () => import_electron.ipcRenderer.send("pet:drag-start"),
  dragEnd: () => import_electron.ipcRenderer.send("pet:drag-end"),
  openMenu: () => import_electron.ipcRenderer.send("pet:menu"),
  setMask: (m) => import_electron.ipcRenderer.send("pet:mask", m),
  log: (msg) => import_electron.ipcRenderer.send("pet:log", msg),
  /** persist=false 时只预览（拖动中），true 时落盘 */
  setScale: (v, persist = false) => import_electron.ipcRenderer.send(persist ? "scale:commit" : "scale:preview", v),
  closeSlider: () => import_electron.ipcRenderer.send("slider:close"),
  onCommand: (cb) => {
    import_electron.ipcRenderer.on("pet:command", (_e, cmd) => cb(cmd));
  },
  onScale: (cb) => {
    import_electron.ipcRenderer.on("pet:scale", (_e, scale) => cb(scale));
  },
  onInputMode: (cb) => {
    import_electron.ipcRenderer.on("pet:input-mode", (_e, v) => cb(v));
  },
  /* ------------------------------- 对话框 ------------------------------- */
  chat: {
    open: (mode) => import_electron.ipcRenderer.send("chat:open", { mode }),
    close: () => import_electron.ipcRenderer.send("chat:close"),
    setMode: (mode) => import_electron.ipcRenderer.send("chat:mode", { mode }),
    send: (text, mode) => import_electron.ipcRenderer.invoke("chat:send", { text, mode }),
    history: () => import_electron.ipcRenderer.invoke("chat:history"),
    reconnect: () => import_electron.ipcRenderer.send("chat:reconnect"),
    audioStarted: () => import_electron.ipcRenderer.send("chat:audio-start"),
    onState: (cb) => on("chat:state", cb),
    onMode: (cb) => on("chat:mode", cb),
    onMessage: (cb) => on("chat:message", cb),
    onTyping: (cb) => on("chat:typing", cb),
    onError: (cb) => on("chat:error", cb),
    onFocusInput: (cb) => on("chat:focus-input", cb),
    onPauseAudio: (cb) => import_electron.ipcRenderer.on("chat:pause-audio", () => cb())
  },
  /* -------------------------------- 气泡 -------------------------------- */
  bubble: {
    ready: () => import_electron.ipcRenderer.send("bubble:ready"),
    resize: (width, height) => import_electron.ipcRenderer.send("bubble:resize", { width, height }),
    action: (action, messageId) => import_electron.ipcRenderer.send("bubble:action", { action, messageId }),
    hover: (hovering) => import_electron.ipcRenderer.send("bubble:hover", { hovering }),
    audioStarted: () => import_electron.ipcRenderer.send("bubble:audio-start"),
    onShow: (cb) => on("bubble:show", cb),
    onHide: (cb) => on("bubble:hide", (_p) => cb()),
    onPauseAudio: (cb) => import_electron.ipcRenderer.on("bubble:pause-audio", () => cb())
  }
});
//# sourceMappingURL=preload.js.map
