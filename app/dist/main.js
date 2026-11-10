"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/main/main.ts
var import_electron2 = require("electron");
var import_node_path3 = __toESM(require("node:path"));
var import_node_fs2 = __toESM(require("node:fs"));
var import_node_os2 = __toESM(require("node:os"));
var import_node_crypto2 = require("node:crypto");
var import_node_url = require("node:url");

// src/main/services.ts
var providers = [
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    requiresKey: true
  },
  {
    id: "ollama",
    label: "Ollama\uFF08\u672C\u5730\uFF09",
    kind: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    models: [],
    requiresKey: false
  }
];
var tools = [
  { name: "pet.say", description: "\u8BA9\u89D2\u8272\u8BF4\u4E00\u53E5\u8BDD\uFF08\u6C14\u6CE1 + \u53E3\u578B\uFF09", risk: "read", confirm: "never", enabled: true },
  { name: "pet.emote", description: "\u5207\u6362\u8868\u60C5 / \u64AD\u653E\u52A8\u4F5C", risk: "read", confirm: "never", enabled: true },
  { name: "pet.sleep", description: "\u8FDB\u5165\u5F85\u673A / \u7761\u7720\u72B6\u6001", risk: "read", confirm: "never", enabled: true },
  { name: "qq.read", description: "\u8BFB\u53D6 QQ \u672A\u8BFB\u6D88\u606F", risk: "read", confirm: "never", enabled: false },
  { name: "qq.reply", description: "\u5728\u6307\u5B9A QQ \u4F1A\u8BDD\u91CC\u56DE\u590D\u4E00\u6761\u6D88\u606F", risk: "external", confirm: "always", enabled: false },
  { name: "bili.open", description: "\u6253\u5F00 B \u7AD9\u9875\u9762\u966A\u770B", risk: "read", confirm: "once", enabled: false },
  { name: "bili.like", description: "\u7ED9\u5F53\u524D\u89C6\u9891\u70B9\u8D5E", risk: "write", confirm: "always", enabled: false }
];
var voice = {
  tts: ["edge-tts", "azure", "gpt-sovits", "system-sapi"],
  asr: ["whisper.cpp", "web-speech", "azure"]
};
function describeServices() {
  return { version: 1, providers, tools, voice };
}

// src/main/chat-host.ts
var import_electron = require("electron");
var import_node_path2 = __toESM(require("node:path"));

// src/main/surfcore.ts
var import_node_fs = __toESM(require("node:fs"));
var import_node_os = __toESM(require("node:os"));
var import_node_path = __toESM(require("node:path"));
var import_node_crypto = require("node:crypto");
var import_node_events = require("node:events");
var CLIENT_ID = `pet-${(0, import_node_crypto.randomUUID)().slice(0, 8)}`;
function dshHome() {
  return String(process.env.DSH_HOME || "").trim() || import_node_path.default.join(import_node_os.default.homedir(), ".dsh");
}
function hostFilePath() {
  return String(process.env.SURFCORE_PET_HOST || "").trim() || import_node_path.default.join(dshHome(), "surfcore", "pet", "host.json");
}
function backoffMs(attempt) {
  return Math.min(15e3, 1500 + attempt * 1500);
}
var SurfCoreClient = class extends import_node_events.EventEmitter {
  host = null;
  connected = false;
  bootId = "";
  cursor = 0;
  // 插件重启后事件序号从 1 重新开始：旧的游标会大于服务端当前序号，
  // 必须在下一轮用「不带 since」的请求重新取水位，否则永远收不到新事件。
  needsBaseline = false;
  stopped = true;
  pollTimer = null;
  attempt = 0;
  lastError = "";
  configCache = null;
  polling = false;
  pollAbort = null;
  get info() {
    return this.host;
  }
  get isConnected() {
    return this.connected;
  }
  get lastConnectError() {
    return this.lastError;
  }
  get config() {
    return this.configCache;
  }
  /** 读 host.json。文件不存在 / 不完整时返回 null，不抛。 */
  readHost() {
    try {
      const raw = JSON.parse(import_node_fs.default.readFileSync(hostFilePath(), "utf8"));
      const baseUrl = String(raw.baseUrl || "").replace(/\/+$/, "");
      const token = String(raw.token || "");
      if (!/^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(baseUrl) || !/^[a-f0-9]{32,80}$/i.test(token)) return null;
      const api = typeof raw.api === "string" && raw.api.startsWith("/") ? raw.api : "/dsh-surfcore/pet-api";
      this.host = { baseUrl, token, api, pluginVersion: raw.pluginVersion, updatedAt: raw.updatedAt };
      return this.host;
    } catch {
      return null;
    }
  }
  async ensureHost(refresh = false) {
    if (!refresh && this.host) return this.host;
    const host = this.readHost();
    if (!host) throw new Error("\u8FD8\u6CA1\u627E\u5230 SurfCore\uFF08~/.dsh/surfcore/pet/host.json\uFF09\uFF1A\u5148\u5728 SurfCore \u8BBE\u7F6E \u2192 \u684C\u5BA0 \u91CC\u542F\u52A8\u4E00\u6B21");
    return host;
  }
  async request(pathname, options = {}) {
    const host = options.host ?? await this.ensureHost();
    const url = `${host.baseUrl}${host.api}${pathname}`;
    const timeoutSignal = AbortSignal.timeout(Math.max(1e3, options.timeoutMs ?? 2e4));
    const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;
    try {
      const init = {
        method: options.method ?? "GET",
        headers: {
          "x-pet-token": host.token,
          ...options.body === void 0 ? {} : { "content-type": "application/json" }
        },
        signal
      };
      if (options.body !== void 0) init.body = JSON.stringify(options.body);
      const res = await fetch(url, init);
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        const message = String(data?.error || `SurfCore HTTP ${res.status}`);
        const error = new Error(message);
        error.status = res.status;
        throw error;
      }
      return data ?? {};
    } finally {
    }
  }
  absoluteUrl(relative) {
    if (!relative) return "";
    if (/^https?:\/\//i.test(relative)) return relative;
    const host = this.host;
    if (!host) return "";
    return `${host.baseUrl}${relative.startsWith("/") ? "" : "/"}${relative}`;
  }
  setConnected(next, error = "") {
    if (error) this.lastError = error;
    if (this.connected === next && !error) return;
    this.connected = next;
    this.emit("connection", { connected: next, error: next ? "" : error || this.lastError });
    if (next) this.lastError = "";
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.pollTimer = null;
    void this.loop();
  }
  stop() {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    try {
      this.pollAbort?.abort();
    } catch {
    }
    this.pollAbort = null;
  }
  schedule(ms) {
    if (this.stopped) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      void this.loop();
    }, Math.max(500, ms));
  }
  async loop() {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      const wantsSince = Boolean(this.bootId) && !this.needsBaseline;
      const query = wantsSince ? `?since=${this.cursor}&wait=25000&client=${CLIENT_ID}` : `?wait=0&client=${CLIENT_ID}`;
      let payload;
      const controller = new AbortController();
      this.pollAbort = controller;
      try {
        payload = await this.request(`/events${query}`, { timeoutMs: 4e4, signal: controller.signal });
      } catch (error) {
        this.readHost();
        throw error;
      } finally {
        this.pollAbort = null;
      }
      if (payload.bootId && payload.bootId !== this.bootId) {
        this.bootId = payload.bootId;
        this.cursor = Number(payload.cursor) || 0;
        this.needsBaseline = true;
      } else {
        this.bootId = payload.bootId || this.bootId;
        this.cursor = Number(payload.cursor) || this.cursor;
        this.needsBaseline = false;
        for (const event of payload.events ?? []) {
          if (event && event.type === "proactive") this.emit("proactive", event);
          this.emit("event", event);
        }
      }
      if (payload.config) {
        this.configCache = payload.config;
        this.emit("config", payload.config);
      }
      this.attempt = 0;
      this.setConnected(true);
      this.schedule(50);
    } catch (error) {
      const message = String(error?.message ?? error);
      this.attempt += 1;
      this.setConnected(false, message);
      this.schedule(backoffMs(this.attempt));
    } finally {
      this.polling = false;
    }
  }
  /** 主动重连一次（右键/设置里点「重连」时用）。 */
  reconnect() {
    this.stop();
    this.bootId = "";
    this.cursor = 0;
    this.start();
  }
  async chat(text, modality) {
    return this.request("/chat", {
      method: "POST",
      body: { text, modality },
      timeoutMs: 18e4
    });
  }
  async history(limit = 60) {
    return this.request(`/history?limit=${encodeURIComponent(String(limit))}`, { timeoutMs: 15e3 });
  }
  /** 专注模式：由插件写 pet/focus.json；桌宠菜单/设置页共用这一份。 */
  async setFocus(enabled) {
    return this.request("/focus", { method: "POST", body: { enabled: enabled === true, source: "pet" }, timeoutMs: 1e4 });
  }
  async fetchConfig() {
    const config = await this.request("/config", { timeoutMs: 1e4 });
    this.configCache = config;
    return config;
  }
  async status() {
    return this.request("/status", { timeoutMs: 1e4 });
  }
};

// src/main/chat-host.ts
var DIALOG_W = 392;
var DIALOG_H = 576;
var BUBBLE_W = 360;
var BUBBLE_MIN_H = 120;
function nowMs() {
  return Date.now();
}
var ChatHost = class {
  client = new SurfCoreClient();
  deps;
  dialog = null;
  bubble = null;
  dialogMode = "text";
  messages = [];
  pending = false;
  config = null;
  connected = false;
  connectError = "";
  focusMode = false;
  bubblePayload = null;
  bubbleVisible = false;
  bubbleHovering = false;
  bubbleTimer = null;
  bubbleHardTimer = null;
  bubbleSize = { w: BUBBLE_W, h: BUBBLE_MIN_H };
  ipcReady = false;
  disposed = false;
  constructor(deps) {
    this.deps = deps;
    this.client.on("event", (event) => this.onEvent(event));
    this.client.on("proactive", (event) => this.onProactive(event));
    this.client.on("connection", (state) => {
      this.connected = Boolean(state.connected);
      this.connectError = state.connected ? "" : state.error || "\u8FDE\u4E0D\u4E0A SurfCore";
      if (this.connected) {
        void this.refreshConfig();
      }
      this.broadcastDialog("chat:state", this.statePayload());
      this.deps.log(`[chat] surfcore ${this.connected ? "connected" : `offline: ${this.connectError}`}`);
    });
    this.client.on("config", (config) => {
      this.config = config;
      this.applyFocus(Boolean(config.focus?.enabled), "config");
      this.broadcastDialog("chat:state", this.statePayload());
    });
  }
  start() {
    this.client.start();
    void this.refreshConfig();
  }
  get currentMode() {
    return this.dialogMode;
  }
  setInitialMode(mode) {
    if (mode === "text" || mode === "voice") this.dialogMode = mode;
  }
  /** 启动时的本地缓存值；连上后以插件 focus.json 为准。 */
  setInitialFocus(enabled) {
    this.focusMode = enabled === true;
  }
  get focusEnabled() {
    return this.focusMode;
  }
  applyFocus(enabled, reason = "remote") {
    const next = enabled === true;
    if (this.focusMode === next) return;
    this.focusMode = next;
    this.deps.log(`[chat] focus mode ${next ? "on" : "off"} (${reason})`);
    if (next) this.hideBubble();
    this.deps.onFocusChange?.(next);
    this.broadcastDialog("chat:state", this.statePayload());
  }
  /** 右键菜单/设置页切换。写插件 focus.json，成功后立刻本地生效。 */
  async setFocusMode(enabled, source = "menu") {
    try {
      const result = await this.client.setFocus(enabled);
      if (result?.ok === false) throw new Error(result.error || "\u8BBE\u7F6E\u4E13\u6CE8\u6A21\u5F0F\u5931\u8D25");
      this.applyFocus(result?.focus?.enabled ?? enabled, source);
      return true;
    } catch (error) {
      this.deps.log("[chat] set focus failed:", String(error?.message ?? error));
      return false;
    }
  }
  get clientRef() {
    return this.client;
  }
  async refreshConfig() {
    try {
      const config = await this.client.fetchConfig();
      this.config = config;
      this.connected = true;
      this.broadcastDialog("chat:state", this.statePayload());
    } catch (error) {
      if (!this.config) this.connectError = String(error?.message ?? error);
    }
  }
  statePayload() {
    return {
      connected: this.connected || this.client.isConnected,
      error: this.connected || this.client.isConnected ? "" : this.connectError || this.client.lastConnectError,
      config: this.config,
      focus: this.focusMode
    };
  }
  /* --------------------------------- 窗口 --------------------------------- */
  petBounds() {
    const pet = this.deps.getPetWindow();
    if (pet && !pet.isDestroyed()) return pet.getBounds();
    const wa = import_electron.screen.getPrimaryDisplay().workArea;
    return { x: wa.x + wa.width - 300, y: wa.y + wa.height - 400, width: 300, height: 400 };
  }
  /** 对话框开着且可见时，语音由对话框播放；气泡只显示文字，避免两个 <audio> 同时响（回音）。 */
  dialogAudioActive() {
    const win2 = this.dialog;
    if (!win2 || win2.isDestroyed() || !win2.isVisible()) return false;
    return true;
  }
  pauseBubbleAudio() {
    const win2 = this.bubble;
    if (!win2 || win2.isDestroyed()) return;
    try {
      win2.webContents.send("bubble:pause-audio", {});
    } catch {
    }
  }
  positionDialog(win2) {
    const pet = this.petBounds();
    const wa = import_electron.screen.getDisplayMatching({ x: pet.x, y: pet.y, width: pet.width, height: pet.height }).workArea;
    const size = win2.getBounds();
    let x = pet.x - size.width - 12;
    let y = pet.y + pet.height - size.height;
    if (x < wa.x + 8) {
      x = pet.x + pet.width + 12;
      if (x + size.width > wa.x + wa.width - 8) x = Math.round(wa.x + (wa.width - size.width) / 2);
    }
    y = Math.min(Math.max(y, wa.y + 8), wa.y + wa.height - size.height - 8);
    win2.setPosition(Math.round(x), Math.round(y));
  }
  openDialog(mode) {
    if (mode === "text" || mode === "voice") this.setMode(mode, true);
    this.pauseBubbleAudio();
    if (this.dialog && !this.dialog.isDestroyed()) {
      if (!this.dialog.isVisible()) this.dialog.show();
      this.dialog.focus();
      this.dialog.webContents.send("chat:mode", { mode: this.dialogMode });
      this.dialog.webContents.send("chat:focus-input", {});
      return;
    }
    const win2 = new import_electron.BrowserWindow({
      width: DIALOG_W,
      height: DIALOG_H,
      minWidth: 330,
      minHeight: 430,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      show: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "\u5927\u5915\u74DC",
      webPreferences: {
        preload: this.deps.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    });
    this.dialog = win2;
    win2.setAlwaysOnTop(true, "floating");
    win2.loadFile(import_node_path2.default.join(this.deps.distDir, "dialog.html"), { query: { mode: this.dialogMode } });
    win2.once("ready-to-show", () => {
      if (!win2.isDestroyed()) {
        this.positionDialog(win2);
        win2.show();
        win2.focus();
      }
    });
    win2.on("closed", () => {
      if (this.dialog === win2) this.dialog = null;
    });
    win2.webContents.on("did-finish-load", () => {
      win2.webContents.send("chat:state", this.statePayload());
      win2.webContents.send("chat:mode", { mode: this.dialogMode });
    });
  }
  closeDialog() {
    if (this.dialog && !this.dialog.isDestroyed()) this.dialog.close();
    this.dialog = null;
  }
  ensureBubble() {
    if (this.bubble && !this.bubble.isDestroyed()) return this.bubble;
    const win2 = new import_electron.BrowserWindow({
      width: this.bubbleSize.w,
      height: this.bubbleSize.h,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "\u5927\u5915\u74DC",
      webPreferences: {
        preload: this.deps.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    });
    this.bubble = win2;
    win2.setAlwaysOnTop(true, "screen-saver");
    win2.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win2.loadFile(import_node_path2.default.join(this.deps.distDir, "bubble.html"));
    win2.on("closed", () => {
      if (this.bubble === win2) this.bubble = null;
      this.bubbleVisible = false;
    });
    return win2;
  }
  positionBubble() {
    const win2 = this.bubble;
    if (!win2 || win2.isDestroyed()) return;
    const pet = this.petBounds();
    const wa = import_electron.screen.getDisplayMatching({ x: pet.x, y: pet.y, width: pet.width, height: pet.height }).workArea;
    const w = this.bubbleSize.w;
    const h = this.bubbleSize.h;
    let x = Math.round(pet.x + pet.width / 2 - w / 2);
    let y = Math.round(pet.y - h - 8);
    if (y < wa.y + 4) {
      y = Math.round(pet.y + Math.min(120, Math.max(24, pet.height * 0.18)));
    }
    x = Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - w - 4);
    y = Math.min(Math.max(y, wa.y + 4), wa.y + wa.height - h - 4);
    win2.setBounds({ x, y, width: w, height: h });
  }
  onPetMoved() {
    if (this.bubbleVisible) this.positionBubble();
  }
  /* -------------------------------- 消息 --------------------------------- */
  withAbsoluteAudio(message) {
    if (!message?.audio?.url) return message;
    return { ...message, audio: { ...message.audio, url: this.client.absoluteUrl(message.audio.url) } };
  }
  remember(message) {
    if (!message?.id) return message;
    const exists = this.messages.some((m) => m.id === message.id);
    if (!exists) this.messages.push(message);
    if (this.messages.length > 240) this.messages = this.messages.slice(-240);
    return message;
  }
  broadcastDialog(channel, payload) {
    const win2 = this.dialog;
    if (!win2 || win2.isDestroyed()) return;
    try {
      win2.webContents.send(channel, payload);
    } catch {
    }
  }
  onEvent(event) {
    if (!event) return;
    if (event.type === "focus") {
      this.applyFocus(event.enabled === true, "event");
      return;
    }
    if (event.type === "reply" && event.text) {
      const message = this.remember(this.withAbsoluteAudio({
        id: String(event.messageId || `reply-${event.id}`),
        role: "assistant",
        text: String(event.text),
        modality: event.modality === "voice" ? "voice" : "text",
        at: Number(event.at) || nowMs(),
        audio: event.audio
      }));
      this.broadcastDialog("chat:message", message);
      this.showBubble(message);
      return;
    }
  }
  onProactive(event) {
    const text = String(event.text || "").trim();
    if (!text) return;
    if (this.focusMode) {
      this.deps.log("[chat] focus mode on: drop proactive");
      return;
    }
    const message = this.remember(this.withAbsoluteAudio({
      id: String(event.messageId || `proactive-${event.id}`),
      role: "assistant",
      text,
      modality: event.modality === "voice" ? "voice" : "text",
      at: Number(event.at) || nowMs(),
      proactive: true,
      audio: event.audio
    }));
    this.broadcastDialog("chat:message", message);
    this.showBubble(message);
  }
  /** 对话框发送（文本/语音）。回复统一走气泡 + 对话框。 */
  async sendChat(text, mode) {
    const say = String(text || "").trim();
    if (!say) return { ok: false, error: "\u8BF4\u70B9\u4EC0\u4E48\u5427" };
    if (this.pending) return { ok: false, error: "\u5979\u8FD8\u5728\u56DE\u4E0A\u4E00\u53E5" };
    if (!this.client.isConnected) {
      return { ok: false, error: this.client.lastConnectError || "\u8FD8\u6CA1\u8FDE\u4E0A SurfCore\uFF08\u5148\u5728\u8BBE\u7F6E \u2192 \u684C\u5BA0 \u91CC\u542F\u52A8\uFF09" };
    }
    this.pending = true;
    this.broadcastDialog("chat:typing", { pending: true });
    try {
      const result = await this.client.chat(say, mode);
      if (!result.ok || !result.reply) throw new Error(result.error || "\u5979\u8FD9\u6B21\u6CA1\u8BF4\u8BDD");
      if (result.userMessage) this.remember(this.withAbsoluteAudio(result.userMessage));
      const reply = this.remember(this.withAbsoluteAudio(result.reply));
      this.broadcastDialog("chat:message", reply);
      this.showBubble(reply);
      return { ok: true };
    } catch (error) {
      const message = String(error?.message ?? error);
      this.broadcastDialog("chat:error", { message });
      this.deps.log("[chat] send failed:", message);
      return { ok: false, error: message };
    } finally {
      this.pending = false;
      this.broadcastDialog("chat:typing", { pending: false });
    }
  }
  async historyPayload() {
    let messages = this.messages.map((m) => this.withAbsoluteAudio(m));
    let roleName = this.config?.role?.name || "\u5915";
    if (this.client.isConnected) {
      try {
        const history = await this.client.history(80);
        if (history?.ok && Array.isArray(history.messages)) {
          messages = history.messages.map((m) => this.withAbsoluteAudio(m));
          this.messages = messages.slice(-240);
          roleName = history.role?.name || roleName;
        }
      } catch (error) {
        this.deps.log("[chat] history failed:", String(error?.message ?? error));
      }
    }
    const state = this.statePayload();
    return {
      ok: true,
      connected: state.connected,
      error: state.error,
      config: state.config,
      role: { name: roleName },
      messages,
      pending: this.pending
    };
  }
  /* -------------------------------- 气泡 --------------------------------- */
  showBubble(message) {
    const payload = {
      messageId: message.id,
      text: message.text,
      modality: message.modality,
      at: message.at,
      proactive: Boolean(message.proactive),
      // 对话框可见时由它播放；气泡仍显示文字 + 播放按钮（用户可手动点）。
      autoplay: !this.dialogAudioActive(),
      audio: message.audio?.url ? { url: message.audio.url, durationMs: Number(message.audio.durationMs) || 0 } : void 0
    };
    const speechMs = payload.audio?.durationMs ? payload.audio.durationMs + 600 : Math.min(15e3, Math.max(3e3, 700 + payload.text.length * 130));
    this.deps.onSpeak(speechMs);
    if (this.bubbleVisible) {
      this.displayBubble(payload);
      return;
    }
    this.displayBubble(payload);
  }
  displayBubble(payload) {
    this.bubblePayload = payload;
    this.bubbleVisible = true;
    this.bubbleHovering = false;
    const win2 = this.ensureBubble();
    const send2 = () => {
      if (win2.isDestroyed()) return;
      win2.webContents.send("bubble:show", payload);
      this.positionBubble();
      try {
        win2.showInactive();
      } catch {
        try {
          win2.show();
        } catch {
        }
      }
    };
    if (win2.webContents.isLoading()) {
      win2.webContents.once("did-finish-load", send2);
    } else {
      send2();
    }
    this.scheduleBubbleHide(payload);
    if (this.bubbleHardTimer) clearTimeout(this.bubbleHardTimer);
    this.bubbleHardTimer = setTimeout(() => this.hideBubble(), 6e4);
  }
  bubbleDuration(payload) {
    const reading = 4500 + Math.min(16e3, payload.text.length * 110);
    const audio = payload.audio?.durationMs ? payload.audio.durationMs + 3500 : 0;
    return Math.min(3e4, Math.max(6500, reading, audio));
  }
  scheduleBubbleHide(payload) {
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => this.hideBubble(), this.bubbleDuration(payload));
  }
  clearBubbleTimer() {
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = null;
  }
  hideBubble() {
    this.clearBubbleTimer();
    if (this.bubbleHardTimer) clearTimeout(this.bubbleHardTimer);
    this.bubbleHardTimer = null;
    this.bubbleVisible = false;
    this.bubblePayload = null;
    this.bubbleHovering = false;
    const win2 = this.bubble;
    if (win2 && !win2.isDestroyed()) {
      try {
        win2.webContents.send("bubble:hide", {});
      } catch {
      }
      try {
        win2.hide();
      } catch {
      }
    }
  }
  setBubbleSize(width, height) {
    const w = Math.max(220, Math.min(520, Math.round(width) || BUBBLE_W));
    const h = Math.max(80, Math.min(420, Math.round(height) || BUBBLE_MIN_H));
    this.bubbleSize = { w, h };
    if (this.bubbleVisible) this.positionBubble();
  }
  bubbleReply(messageId) {
    const message = this.messages.find((m) => m.id === messageId);
    const mode = message?.modality === "voice" ? "voice" : "text";
    this.hideBubble();
    this.openDialog(mode);
  }
  /* --------------------------------- 模式 --------------------------------- */
  setMode(mode, persist = false) {
    const next = mode === "voice" ? "voice" : "text";
    this.dialogMode = next;
    this.broadcastDialog("chat:mode", { mode: next });
    if (persist) this.deps.onModeChange(next);
  }
  /* --------------------------------- IPC --------------------------------- */
  registerIpc(ipcMain2) {
    if (this.ipcReady) return;
    this.ipcReady = true;
    ipcMain2.on("chat:open", (_e, payload) => {
      this.openDialog(payload?.mode);
    });
    ipcMain2.on("chat:close", (event) => {
      if (this.dialog && event.sender === this.dialog.webContents) this.closeDialog();
    });
    ipcMain2.on("chat:mode", (_e, payload) => {
      this.setMode(payload?.mode === "voice" ? "voice" : "text", true);
    });
    ipcMain2.handle("chat:send", async (_e, payload) => {
      return this.sendChat(String(payload?.text || ""), payload?.mode === "voice" ? "voice" : "text");
    });
    ipcMain2.handle("chat:history", async () => this.historyPayload());
    ipcMain2.on("chat:reconnect", () => this.client.reconnect());
    ipcMain2.on("chat:audio-start", () => this.pauseBubbleAudio());
    ipcMain2.on("bubble:audio-start", () => {
      const win2 = this.dialog;
      if (win2 && !win2.isDestroyed()) {
        try {
          win2.webContents.send("chat:pause-audio", {});
        } catch {
        }
      }
    });
    ipcMain2.on("bubble:ready", () => {
      if (this.bubbleVisible) this.positionBubble();
    });
    ipcMain2.on("bubble:resize", (_e, payload) => {
      this.setBubbleSize(Number(payload?.width), Number(payload?.height));
    });
    ipcMain2.on("bubble:action", (_e, payload) => {
      if (payload?.action === "reply" && payload.messageId) this.bubbleReply(payload.messageId);
      else if (payload?.action === "close") this.hideBubble();
    });
    ipcMain2.on("bubble:hover", (_e, payload) => {
      const hovering = Boolean(payload?.hovering);
      this.bubbleHovering = hovering;
      if (hovering) {
        this.clearBubbleTimer();
      } else if (this.bubbleVisible && this.bubblePayload) {
        this.scheduleBubbleHide(this.bubblePayload);
      }
    });
  }
  /* -------------------------------- 自测/状态 ----------------------------- */
  /** 自测用：不经过模型，直接验证气泡与对话框的显示/排版。 */
  async demo() {
    const sample = {
      id: `demo-${nowMs()}`,
      role: "assistant",
      text: "\u54AA\u2026\u4E3B\u4EBA\u4ECA\u5929\u6478\u6478 wo \u7684\u5934\uFF0Cwo \u5C31\u4E00\u76F4\u5728\u7B49\u4E0B\u4E00\u53E5\u5566 mer",
      modality: "text",
      at: nowMs(),
      proactive: true
    };
    this.remember(sample);
    this.openDialog("text");
    this.showBubble(sample);
    await new Promise((r) => setTimeout(r, 900));
    const user = { id: `demo-u-${nowMs()}`, role: "user", text: "\u5728\u5E72\u561B\u5440", modality: "text", at: nowMs() };
    const reply = {
      id: `demo-r-${nowMs()}`,
      role: "assistant",
      text: "\u6CA1\u5E72\u561B\u5440\uFF0C\u5C31\u5728\u684C\u9762\u4E0A\u53D1\u5446\u7B49\u4E3B\u4EBA\u6765\u6233 wo \u5462 mer",
      modality: "voice",
      at: nowMs()
    };
    this.broadcastDialog("chat:message", user);
    this.broadcastDialog("chat:message", {
      ...reply,
      audio: { key: "demo", url: "", durationMs: 2200 }
    });
    await new Promise((r) => setTimeout(r, 700));
  }
  debugWindows() {
    return { dialog: this.dialog, bubble: this.bubble };
  }
  status() {
    return {
      connected: this.connected || this.client.isConnected,
      error: this.connected || this.client.isConnected ? "" : this.connectError || this.client.lastConnectError,
      mode: this.dialogMode,
      focus: this.focusMode,
      messages: this.messages.length,
      bubbleVisible: this.bubbleVisible,
      dialogOpen: Boolean(this.dialog && !this.dialog.isDestroyed()),
      role: this.config?.role?.name ?? "",
      host: this.client.info?.baseUrl ?? ""
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearBubbleTimer();
    if (this.bubbleHardTimer) clearTimeout(this.bubbleHardTimer);
    this.client.stop();
    for (const win2 of [this.dialog, this.bubble]) {
      try {
        if (win2 && !win2.isDestroyed()) win2.destroy();
      } catch {
      }
    }
    this.dialog = null;
    this.bubble = null;
  }
};

// src/main/main.ts
var SNAP_DIST = 28;
var MIN_SCALE = 0.2;
var MAX_SCALE = 2;
var MARGIN_X = 10;
var MARGIN_TOP = 40;
var isPreview = process.argv.includes("--preview");
var isSelftest = process.argv.includes("--selftest");
var wantPreview = isPreview || isSelftest;
var skinArg = process.argv.find((a) => a.startsWith("--skin="));
var actionArg = process.argv.find((a) => a.startsWith("--action="));
var captureArg = process.argv.find((a) => a.startsWith("--capture="));
var capturePath = captureArg ? captureArg.slice("--capture=".length) : null;
var win = null;
var slider = null;
var tray = null;
var chatHost = null;
var dragTimer = null;
var snapTimer = null;
var inputPoll = null;
var talkTimer = null;
var talkUntil = 0;
var talking = false;
var dragOffset = { x: 0, y: 0 };
var debugIgnore = true;
var menuOpenCount = 0;
var pollPaused = false;
var skinCache = null;
var maskData = null;
var currentScale = 0.44;
var lastBubbleMove = 0;
function appRoot() {
  return import_electron2.app.getAppPath();
}
if (!import_electron2.app.isPackaged) {
  const key = (0, import_node_crypto2.createHash)("sha1").update(appRoot()).digest("hex").slice(0, 10);
  const candidates = [
    // 安装目录内的 profile 优先：安装目录一般可写，也天然按副本隔离
    import_node_path3.default.join(appRoot(), "data", isSelftest ? "userdata-selftest" : "userdata"),
    import_node_path3.default.join(import_electron2.app.getPath("appData"), "feiyu-pet", isSelftest ? `selftest-${key}` : key),
    import_node_path3.default.join(import_node_os2.default.tmpdir(), "feiyu-pet", key)
  ];
  for (const dir of candidates) {
    try {
      import_node_fs2.default.mkdirSync(dir, { recursive: true });
      import_node_fs2.default.writeFileSync(import_node_path3.default.join(dir, ".write-probe"), "ok");
      import_node_fs2.default.rmSync(import_node_path3.default.join(dir, ".write-probe"), { force: true });
      import_electron2.app.setPath("userData", dir);
      break;
    } catch {
    }
  }
}
var hasSingleInstance = import_electron2.app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  import_electron2.app.quit();
} else {
  import_electron2.app.on("second-instance", () => {
    if (win) win.showInactive();
  });
}
var settings = { scale: 0.44, skin: "" };
function settingsPath() {
  return import_node_path3.default.join(import_electron2.app.getPath("userData"), "settings.json");
}
function loadSettings() {
  try {
    const raw = JSON.parse(import_node_fs2.default.readFileSync(settingsPath(), "utf8"));
    const scale = typeof raw.scale === "number" ? raw.scale : 0.44;
    return {
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)),
      skin: typeof raw.skin === "string" ? raw.skin : "",
      dialogMode: raw.dialogMode === "voice" ? "voice" : "text",
      focusMode: raw.focusMode === true
    };
  } catch {
    return { scale: 0.44, skin: "", dialogMode: "text", focusMode: false };
  }
}
function persistSettings() {
  try {
    import_node_fs2.default.mkdirSync(import_node_path3.default.dirname(settingsPath()), { recursive: true });
    import_node_fs2.default.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.warn("[settings] save failed", err);
  }
}
function skinsDir() {
  return import_node_path3.default.join(appRoot(), "skins");
}
function listSkins() {
  const dir = skinsDir();
  if (!import_node_fs2.default.existsSync(dir)) return [];
  const out = [];
  for (const id of import_node_fs2.default.readdirSync(dir)) {
    const mf = import_node_path3.default.join(dir, id, "manifest.json");
    if (!import_node_fs2.default.existsSync(mf)) continue;
    try {
      const m = JSON.parse(import_node_fs2.default.readFileSync(mf, "utf8"));
      out.push({ id, name: m.name || id, dir: import_node_path3.default.join(dir, id) });
    } catch {
      console.warn("[skin] bad manifest:", id);
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
function loadSkin() {
  const entries = listSkins();
  if (entries.length === 0) throw new Error("no skin found in skins/");
  const chosen = entries.find((e) => e.id === settings.skin) ?? entries[0];
  settings.skin = chosen.id;
  const manifest = JSON.parse(import_node_fs2.default.readFileSync(import_node_path3.default.join(chosen.dir, "manifest.json"), "utf8"));
  return {
    manifest,
    baseUrl: (0, import_node_url.pathToFileURL)(chosen.dir).href + "/",
    skinCount: entries.length,
    scale: currentScale,
    id: chosen.id,
    skins: entries.map((e) => ({ id: e.id, name: e.name }))
  };
}
function getSkin() {
  if (!skinCache) skinCache = loadSkin();
  return skinCache;
}
function switchSkin(id) {
  if (!win) return;
  if (getSkin().id === id) return;
  const oldHitH = getSkin().manifest.hitbox.h;
  settings.skin = id;
  skinCache = null;
  maskData = null;
  const newHitH = getSkin().manifest.hitbox.h;
  if (oldHitH > 0 && newHitH > 0) {
    currentScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldHitH * currentScale / newHitH));
    settings.scale = currentScale;
  }
  persistSettings();
  const { w, h } = computeWinSize(currentScale);
  const b = win.getBounds();
  win.setBounds({ x: Math.round(b.x + b.width - w), y: Math.round(b.y + b.height - h), width: w, height: h });
  console.log("[skin] switch ->", id, "canvas:", getSkin().manifest.canvas, "want:", w, h, "now:", win.getBounds());
  chatHost?.onPetMoved();
  win.webContents.reload();
}
function computeWinSize(scale) {
  const m = getSkin().manifest;
  const wa = workArea();
  const maxW = Math.max(240, wa.width - 24);
  const maxH = Math.max(240, wa.height - 24);
  return {
    w: Math.min(Math.round(m.canvas.w * scale) + MARGIN_X, maxW),
    h: Math.min(Math.round(m.canvas.h * scale) + MARGIN_TOP, maxH)
  };
}
function rootOffsetFor(scale, w, h) {
  const skin = getSkin().manifest;
  const cw = skin.canvas.w * scale;
  const chh = skin.canvas.h * scale;
  const headroom = 40;
  const sFit = (h - headroom) / skin.canvas.h;
  const t = sFit > 0 ? Math.min(1, Math.max(0, (scale - sFit) / (0.35 * sFit))) : 0;
  const yBottom = h - chh;
  const yHead = headroom - skin.hitbox.y * scale;
  return { x: (w - cw) / 2, y: yBottom + (yHead - yBottom) * t };
}
function rootOffset(scale) {
  const { w, h } = computeWinSize(scale);
  return rootOffsetFor(scale, w, h);
}
function ensureMask() {
  if (maskData) return;
  const m = getSkin().manifest;
  const rel = m.interaction?.mask;
  if (!rel) return;
  const p = import_node_path3.default.join(appRoot(), "skins", m.id, rel);
  if (!import_node_fs2.default.existsSync(p)) return;
  const img = import_electron2.nativeImage.createFromPath(p);
  if (img.isEmpty()) return;
  const size = img.getSize();
  const bmp = img.toBitmap();
  const bits = new Uint8Array(size.width * size.height);
  for (let i = 0; i < bits.length; i++) bits[i] = bmp[i * 4] > 96 ? 1 : 0;
  maskData = { w: size.width, h: size.height, bits };
}
function hitAtWindow(localX, localY) {
  const m = getSkin().manifest;
  const s = currentScale;
  const b = win?.getBounds();
  const root = b ? rootOffsetFor(s, b.width, b.height) : rootOffset(s);
  const cx = (localX - root.x) / s;
  const cy = (localY - root.y) / s;
  const hb = m.hitbox;
  if (cx < hb.x || cx > hb.x + hb.w || cy < hb.y || cy > hb.y + hb.h) return false;
  ensureMask();
  if (!maskData) return true;
  const mx = Math.floor(cx / m.canvas.w * maskData.w);
  const my = Math.floor(cy / m.canvas.h * maskData.h);
  if (mx < 0 || my < 0 || mx >= maskData.w || my >= maskData.h) return false;
  return maskData.bits[my * maskData.w + mx] > 0;
}
function startInputPolling() {
  if (inputPoll) return;
  inputPoll = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    if (pollPaused) return;
    if (dragTimer) {
      setInteractive(true);
      return;
    }
    const p = import_electron2.screen.getCursorScreenPoint();
    const b = win.getBounds();
    let inside = false;
    if (p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height) {
      inside = hitAtWindow(p.x - b.x, p.y - b.y);
    }
    setInteractive(inside);
  }, 16);
}
function setInteractive(v) {
  if (v === !debugIgnore) return;
  debugIgnore = !v;
  const p = import_electron2.screen.getCursorScreenPoint();
  const b = win?.getBounds();
  console.log("[input] interactive =", v, JSON.stringify({ cursor: p, bounds: b, scale: currentScale }));
  win?.setIgnoreMouseEvents(!v, { forward: true });
  win?.webContents.send("pet:input-mode", v);
}
function workArea() {
  return import_electron2.screen.getPrimaryDisplay().workArea;
}
function placeDefault() {
  if (!win) return;
  const wa = workArea();
  const { w, h } = computeWinSize(currentScale);
  win.setBounds({
    x: Math.round(wa.x + wa.width - w - 24),
    y: Math.round(wa.y + wa.height - h),
    width: w,
    height: h
  });
  chatHost?.onPetMoved();
}
function createWindow() {
  const { w, h } = computeWinSize(currentScale);
  win = new import_electron2.BrowserWindow({
    width: w,
    height: h,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: import_node_path3.default.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setBackgroundColor("#00000000");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  const query = wantPreview ? { preview: "1" } : {};
  win.loadFile(import_node_path3.default.join(__dirname, "index.html"), { query });
  win.once("ready-to-show", () => {
    placeDefault();
    win?.showInactive();
    startInputPolling();
  });
  win.on("closed", () => {
    win = null;
  });
}
function applyScale(next, persist = true) {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  currentScale = scale;
  settings.scale = scale;
  if (persist) persistSettings();
  if (!win) return;
  const { w, h } = computeWinSize(scale);
  const b = win.getBounds();
  win.setBounds({
    x: Math.round(b.x + b.width - w),
    y: Math.round(b.y + b.height - h),
    width: w,
    height: h
  });
  win.webContents.send("pet:scale", scale);
  chatHost?.onPetMoved();
}
function openSlider() {
  if (!win) return;
  if (slider && !slider.isDestroyed()) {
    slider.show();
    slider.focus();
    return;
  }
  const b = win.getBounds();
  const w = 320;
  const h = 92;
  const x = Math.round(b.x + (b.width - w) / 2);
  const y = Math.max(8, b.y - h - 10);
  slider = new import_electron2.BrowserWindow({
    x,
    y,
    width: w,
    height: h,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: import_node_path3.default.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  slider.setAlwaysOnTop(true, "screen-saver");
  slider.loadFile(import_node_path3.default.join(__dirname, "slider.html"), {
    query: { scale: String(currentScale), min: String(MIN_SCALE), max: String(MAX_SCALE) }
  });
  slider.once("ready-to-show", () => slider?.show());
  slider.on("closed", () => {
    slider = null;
  });
}
var dragPin = null;
function stopDrag() {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
  dragPin = null;
}
function startDrag() {
  if (!win) return;
  stopDrag();
  if (snapTimer) {
    clearInterval(snapTimer);
    snapTimer = null;
  }
  const bounds = win.getBounds();
  dragPin = { w: bounds.width, h: bounds.height };
  const cursor = import_electron2.screen.getCursorScreenPoint();
  dragOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  dragTimer = setInterval(() => {
    if (!win) return;
    const p = import_electron2.screen.getCursorScreenPoint();
    let x = Math.round(p.x - dragOffset.x);
    let y = Math.round(p.y - dragOffset.y);
    try {
      const wa = import_electron2.screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) }).workArea;
      const keep = 60;
      x = Math.min(Math.max(x, wa.x - (win.getBounds().width - keep)), wa.x + wa.width - keep);
      y = Math.min(Math.max(y, wa.y), wa.y + wa.height - keep);
    } catch {
    }
    const w = dragPin?.w ?? win.getBounds().width;
    const h = dragPin?.h ?? win.getBounds().height;
    win.setBounds({ x, y, width: w, height: h });
    const nb = win.getBounds();
    if (nb.width !== w || nb.height !== h) {
      try {
        win.setSize(w, h);
      } catch {
      }
    }
    if (Date.now() - lastBubbleMove > 60) {
      lastBubbleMove = Date.now();
      chatHost?.onPetMoved();
    }
  }, 16);
}
function __snapGuard(msg) {
  try {
    const p = import_node_path3.default.join(import_electron2.app.getPath("userData"), "snap-guard.log");
    import_node_fs2.default.appendFileSync(p, new Date().toISOString() + " " + msg + "\n");
  } catch (e) { }
}
function animateTo(targetX, targetY) {
  if (!win) return;
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    __snapGuard("animateTo entry bad target tx=" + targetX + " ty=" + targetY);
    return;
  }
  if (snapTimer) clearInterval(snapTimer);
  const [sx, sy] = win.getPosition();
  const start = Date.now();
  const dur = 160;
  snapTimer = setInterval(() => {
    if (!win) return;
    const t = Math.min(1, (Date.now() - start) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    const __nx = Math.round(sx + (targetX - sx) * e);
    const __ny = Math.round(sy + (targetY - sy) * e);
    if (!Number.isFinite(__nx) || !Number.isFinite(__ny) || Math.abs(__nx) > 30000 || Math.abs(__ny) > 30000) {
      __snapGuard("animateTo bad pos nx=" + __nx + " ny=" + __ny + " sx=" + sx + " sy=" + sy + " tx=" + targetX + " ty=" + targetY);
      if (snapTimer) { clearInterval(snapTimer); snapTimer = null; }
      return;
    }
    win.setPosition(__nx, __ny);
    if (t >= 1 && snapTimer) {
      clearInterval(snapTimer);
      snapTimer = null;
    }
  }, 8);
}
function snapToEdge() {
  if (!win) return;
  const wa = workArea();
  const { w, h } = computeWinSize(currentScale);
  const [x, y] = win.getPosition();
  let nx = x;
  let ny = y;
  if (Math.abs(x - wa.x) < SNAP_DIST) nx = wa.x;
  if (Math.abs(wa.x + wa.width - (x + w)) < SNAP_DIST) nx = wa.x + wa.width - w;
  if (Math.abs(y - wa.y) < SNAP_DIST) ny = wa.y;
  if (Math.abs(wa.y + wa.height - (y + h)) < SNAP_DIST) ny = wa.y + wa.height - h;
  if (nx !== x || ny !== y) animateTo(nx, ny);
}
function send(cmd) {
  win?.webContents.send("pet:command", cmd);
}
function speakFor(durationMs) {
  if (!win || win.isDestroyed()) return;
  const ms = Math.max(900, Math.min(6e4, Math.round(durationMs || 0)));
  talkUntil = Math.max(talkUntil, Date.now() + ms);
  if (!talking) {
    talking = true;
    send("talk-start");
  }
  if (talkTimer) clearTimeout(talkTimer);
  talkTimer = setTimeout(() => {
    talkTimer = null;
    stopTalking();
  }, Math.max(0, talkUntil - Date.now()));
}
function stopTalking() {
  if (talkTimer) {
    clearTimeout(talkTimer);
    talkTimer = null;
  }
  talkUntil = 0;
  if (!talking) return;
  talking = false;
  send("talk-stop");
}
function hidePet() {
  chatHost?.hideBubble();
  win?.hide();
}
function showPet() {
  win?.showInactive();
}
function buildSkinSubmenu() {
  const current = getSkin().id;
  return {
    label: "\u7A7F\u4EC0\u4E48\u5462",
    submenu: listSkins().map((s) => ({
      label: s.name,
      type: "radio",
      checked: s.id === current,
      click: () => switchSkin(s.id)
    }))
  };
}
var MENU_ACTIONS = {
  wag: { label: "\u6447\u6447\u5C3E\u5DF4", run: () => send("wag") },
  tailpet: { label: "\u6478\u6478\u5C3E\u5DF4", run: () => send("tailpet") },
  pat: { label: "\u6478\u6478\u5934", run: () => send("pat") },
  poke: { label: "\u6233\u4E00\u4E0B", run: () => send("poke") },
  hop: { label: "\u8DF3\u4E00\u4E0B", run: () => send("hop") },
  blink: { label: "\u7728\u4E2A\u773C", run: () => send("blink") },
  talk: { label: "\u8BF4\u53E5\u8BDD", run: () => send("talk") },
  mouth: { label: "\u5F20\u4E2A\u5634", run: () => send("mouth") },
  resize: { label: "\u8C03\u6574\u5927\u5C0F\u2026", run: () => openSlider() },
  recenter: { label: "\u56DE\u5230\u53F3\u4E0B\u89D2", run: () => placeDefault() },
  hide: { label: "\u9690\u85CF", run: () => hidePet() },
  quit: { label: "\u9000\u51FA", run: () => import_electron2.app.quit() }
};
function chatMenuItems() {
  return [
    { label: "\u6587\u672C\u5BF9\u8BDD", click: () => chatHost?.openDialog("text") },
    { label: "\u8BED\u97F3\u5BF9\u8BDD", click: () => chatHost?.openDialog("voice") },
    { type: "separator" }
  ];
}
function focusMenuItem() {
  return {
    label: "\u4E13\u6CE8\u6A21\u5F0F\uFF08\u4E0D\u4E3B\u52A8\u6253\u6270\uFF09",
    type: "checkbox",
    checked: chatHost ? chatHost.focusEnabled : settings.focusMode === true,
    click: (item) => {
      void toggleFocus(Boolean(item.checked));
    }
  };
}
async function toggleFocus(enabled) {
  if (!chatHost) return;
  const ok = await chatHost.setFocusMode(enabled, "menu");
  if (!ok) {
    console.warn("[focus] \u8BBE\u7F6E\u5931\u8D25\uFF1ASurfCore \u6CA1\u8FDE\u4E0A\uFF1F");
    return;
  }
  settings.focusMode = chatHost.focusEnabled;
  persistSettings();
  refreshTrayMenu();
}
function showContextMenu() {
  if (!win) return null;
  const ids = getSkin().manifest.interaction?.menu ?? [
    "resize",
    "separator",
    "recenter",
    "hide",
    "quit"
  ];
  const template = [
    ...chatMenuItems(),
    focusMenuItem(),
    { type: "separator" },
    buildSkinSubmenu(),
    buildThemeSubmenu(),
    { type: "separator" }
  ];
  for (const id of ids) {
    if (id === "separator") {
      template.push({ type: "separator" });
      continue;
    }
    const action = MENU_ACTIONS[id];
    if (!action) continue;
    template.push({ label: action.label, click: action.run });
  }
  menuOpenCount += 1;
  const menu = import_electron2.Menu.buildFromTemplate(template);
  menu.popup({ window: win });
  return menu;
}
/* ---------------- 主题（themes/*.css，右键菜单可切） ---------------- */
function themeDir() { return import_node_path3.default.join(appRoot(), "themes"); }
function listThemes() {
  try {
    return import_node_fs2.default.readdirSync(themeDir())
      .filter((f) => f.toLowerCase().endsWith(".css")).sort()
      .map((f) => {
        const head = import_node_fs2.default.readFileSync(import_node_path3.default.join(themeDir(), f), "utf8").slice(0, 400);
        const m = head.match(/name:\s*([^\r\n*]+)/);
        return { id: f.replace(/\.css$/i, ""), file: f, name: m ? m[1].trim() : f.replace(/\.css$/i, "") };
      });
  } catch (e) { console.warn("[theme] list failed:", e && e.message); return []; }
}
var themeKeys = new WeakMap();
function applyThemeTo(wc) {
  if (!wc || wc.isDestroyed()) return;
  const list = listThemes();
  if (list.length === 0) return;
  const pick = list.find((t) => t.id === settings.theme) || list[0];
  let css = "";
  try { css = import_node_fs2.default.readFileSync(import_node_path3.default.join(themeDir(), pick.file), "utf8"); } catch (e) { return; }
  const put = () => { wc.insertCSS(css).then((k) => themeKeys.set(wc, k)).catch(() => { }); };
  const old = themeKeys.get(wc);
  if (old) wc.removeInsertedCSS(old).then(put).catch(put); else put();
}
function applyThemeAll() {
  try {
    for (const w of import_electron2.BrowserWindow.getAllWindows()) applyThemeTo(w.webContents);
  } catch (e) { }
}
function buildThemeSubmenu() {
  const list = listThemes();
  const cur = settings.theme || (list[0] && list[0].id);
  return {
    label: "\u4E3B\u9898",
    submenu: list.length === 0
      ? [{ label: "（themes 目录是空的）", enabled: false }]
      : list.map((t) => ({
        label: t.name,
        type: "radio",
        checked: cur === t.id,
        click: () => {
          settings.theme = t.id;
          persistSettings();
          applyThemeAll();
          console.log("[theme] ->", t.id);
        }
      }))
  };
}
import_electron2.app.on("browser-window-created", (_e, w) => {
  try { w.webContents.on("dom-ready", () => applyThemeTo(w.webContents)); } catch (err) { }
});
function trayTemplate() {
  return [
    ...chatMenuItems(),
    focusMenuItem(),
    { type: "separator" },
    buildSkinSubmenu(),
    buildThemeSubmenu(),
    { type: "separator" },
    { label: "\u8C03\u6574\u5927\u5C0F\u2026", click: () => openSlider() },
    { label: "\u663E\u793A / \u9690\u85CF", click: () => win?.isVisible() ? hidePet() : showPet() },
    { label: "\u56DE\u5230\u53F3\u4E0B\u89D2", click: placeDefault },
    { type: "separator" },
    { label: "\u9000\u51FA", click: () => import_electron2.app.quit() }
  ];
}
function refreshTrayMenu() {
  if (!tray) return;
  try {
    tray.setContextMenu(import_electron2.Menu.buildFromTemplate(trayTemplate()));
  } catch (err) {
    console.warn("[tray] refresh failed:", err);
  }
}
function createTray() {
  const iconPath = import_node_path3.default.join(appRoot(), "assets", "tray.png");
  if (!import_node_fs2.default.existsSync(iconPath)) {
    console.warn("[tray] icon missing");
    return;
  }
  try {
    const icon = import_electron2.nativeImage.createFromPath(iconPath);
    tray = new import_electron2.Tray(icon.isEmpty() ? import_electron2.nativeImage.createEmpty() : icon);
    tray.setToolTip("\u5927\u5915\u74DC");
    tray.setContextMenu(import_electron2.Menu.buildFromTemplate(trayTemplate()));
    tray.on("click", () => win?.isVisible() ? hidePet() : showPet());
    console.log("[tray] created");
  } catch (err) {
    console.warn("[tray] failed:", err);
  }
}
var wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function snapshot(dir, name) {
  if (!win) return;
  const img = await win.webContents.capturePage();
  import_node_fs2.default.writeFileSync(import_node_path3.default.join(dir, `${name}.png`), img.toPNG());
  console.log("[selftest]", name);
}
async function runSelftest() {
  if (!win) return;
  const dir = import_node_path3.default.join(appRoot(), "out", "selftest");
  import_node_fs2.default.mkdirSync(dir, { recursive: true });
  win.on("resize", () => {
    if (!dragPin || !win || win.isDestroyed()) return;
    const b2 = win.getBounds();
    if (b2.width === dragPin.w && b2.height === dragPin.h) return;
    try {
      win.setBounds({ x: b2.x, y: b2.y, width: dragPin.w, height: dragPin.h });
    } catch {
    }
  });
  win.setPosition(320, 240);
  await wait(1400);
  await snapshot(dir, "01-idle");
  await win.webContents.executeJavaScript("window.__rig && window.__rig.setPointer(60, 40)");
  await wait(650);
  await snapshot(dir, "02-gaze-up-left");
  await win.webContents.executeJavaScript("window.__rig && window.__rig.setPointer(430, 470)");
  await wait(650);
  await snapshot(dir, "03-gaze-down-right");
  send("blink");
  await wait(110);
  await snapshot(dir, "04-blink");
  await wait(500);
  await win.webContents.executeJavaScript("window.__rig && window.__rig.setDragging(true)");
  await wait(450);
  await snapshot(dir, "05-drag");
  await win.webContents.executeJavaScript("window.__rig && window.__rig.setDragging(false)");
  await wait(300);
  send("talk");
  await wait(300);
  await snapshot(dir, "06-talk");
  await wait(900);
  await wait(1500);
  send("talk-start");
  let maxOpen = 0;
  for (let i = 0; i < 6; i++) {
    await wait(120);
    maxOpen = Math.max(maxOpen, Number(await win.webContents.executeJavaScript("window.__rig.mouthOpen")) || 0);
  }
  const holdOn = await win.webContents.executeJavaScript("window.__rig.talking");
  send("talk-stop");
  await wait(450);
  const holdOff = await win.webContents.executeJavaScript("window.__rig.talking");
  const holdClosed = Number(await win.webContents.executeJavaScript("window.__rig.mouthOpen")) || 0;
  console.log(
    "[selftest] talk-hold:",
    holdOn === true && maxOpen > 0.2,
    "->stop:",
    holdOff === false && holdClosed < 0.2,
    JSON.stringify({ maxOpen, holdClosed })
  );
  send("hop");
  await wait(170);
  await snapshot(dir, "07-hop");
  const b = win.getBounds();
  const s = currentScale;
  const root = rootOffset(s);
  const headLocal = { x: root.x + 596 * s, y: root.y + 320 * s };
  const outLocal = { x: 4, y: 4 };
  console.log(
    "[selftest] mask-hit:",
    hitAtWindow(headLocal.x, headLocal.y) === true && hitAtWindow(outLocal.x, outLocal.y) === false
  );
  pollPaused = true;
  setInteractive(true);
  await wait(120);
  const on = await win.webContents.executeJavaScript("window.pet.getDebugState()");
  setInteractive(false);
  await wait(120);
  const off = await win.webContents.executeJavaScript("window.pet.getDebugState()");
  console.log("[selftest] click-through:", on.ignore === false && off.ignore === true, JSON.stringify({ on, off }));
  await win.webContents.executeJavaScript("window.__rig.setHeadHover(true)");
  await wait(500);
  await snapshot(dir, "08-hover-head-eyes-closed");
  const hoverEye = await win.webContents.executeJavaScript("window.__rig.hoverEye");
  await win.webContents.executeJavaScript("window.__rig.setHeadHover(false)");
  console.log("[selftest] head-hover-eyes:", hoverEye, "(>=0.9 = closed)");
  applyScale(0.55, false);
  await wait(500);
  await snapshot(dir, "09-scale-055");
  const applied = await win.webContents.executeJavaScript(
    "({ scale: window.__rig.scale, rootScale: window.__rig.root.scale.x, rootX: window.__rig.root.x, rootY: window.__rig.root.y })"
  );
  console.log("[selftest] scale:", currentScale, "size:", JSON.stringify(computeWinSize(currentScale)), "renderer:", JSON.stringify(applied));
  openSlider();
  await wait(700);
  const sliderState = await win.webContents.executeJavaScript("window.pet.getDebugState()");
  console.log("[selftest] slider:", sliderState.sliderOpen === true);
  if (slider && !slider.isDestroyed()) {
    const shot = await slider.webContents.capturePage();
    import_node_fs2.default.writeFileSync(import_node_path3.default.join(dir, "10-slider.png"), shot.toPNG());
    console.log("[selftest] 10-slider");
  }
  applyScale(0.48, false);
  await wait(300);
  slider?.close();
  await wait(200);
  applyScale(0.9, false);
  await wait(500);
  await snapshot(dir, "12-scale-090");
  applyScale(1.5, false);
  await wait(500);
  await snapshot(dir, "13-scale-150");
  applyScale(MAX_SCALE, false);
  await wait(700);
  const big = await win.webContents.executeJavaScript(
    "({ scale: window.__rig.root.scale.x, winW: window.innerWidth, winH: window.innerHeight })"
  );
  console.log("[selftest] scale-max:", JSON.stringify(big));
  await snapshot(dir, "11-scale-200");
  applyScale(0.44, false);
  await wait(400);
  const before = await win.webContents.executeJavaScript("window.pet.getDebugState()");
  console.log("[selftest] skins:", JSON.stringify({ id: before.skinId, names: before.skinNames }));
  const loaded = new Promise((r) => win.webContents.once("did-finish-load", () => r()));
  switchSkin("xi-05-shuiyi");
  await loaded;
  await wait(900);
  const after = await win.webContents.executeJavaScript("window.pet.getDebugState()");
  console.log("[selftest] skin-switch:", after.skinId === "xi-05-shuiyi", "->", after.skinId);
  await snapshot(dir, "12-skin-switched");
  send("wag");
  await wait(160);
  const tailRot = await win.webContents.executeJavaScript("window.__rig.tailWrap ? window.__rig.tailWrap.rotation : null");
  await snapshot(dir, "13-skin2-wag");
  console.log("[selftest] tail-wag rotation:", tailRot);
  await wait(700);
  send("blink");
  await wait(110);
  await snapshot(dir, "14-skin2-blink");
  await wait(600);
  send("tailpet");
  await wait(260);
  await snapshot(dir, "16-skin2-tailpet");
  await wait(600);
  send("talk");
  await wait(260);
  await snapshot(dir, "17-skin2-talk");
  await wait(700);
  send("pat");
  await wait(280);
  await snapshot(dir, "18-skin2-pat");
  await wait(600);
  const loaded5 = new Promise((r) => win.webContents.once("did-finish-load", () => r()));
  switchSkin("xi-01-wenrou");
  await loaded5;
  await wait(900);
  const s5 = currentScale;
  const r5 = rootOffset(s5);
  const potX = r5.x + 650 * s5;
  const potY = r5.y + 425 * s5;
  const sfx = await win.webContents.executeJavaScript(`(() => {
    // \u7528\u6E32\u67D3\u8FDB\u7A0B\u81EA\u5DF1\u7684 root \u53D8\u6362\u7B97\u5C4F\u5E55\u5750\u6807\uFF0C\u907F\u514D\u4E3B\u8FDB\u7A0B/\u6E32\u67D3\u8FDB\u7A0B\u7F29\u653E\u4E0D\u540C\u6B65
    const r = window.__rig;
    const s = r.root.scale.x;
    const x = r.root.x + 650 * s;
    const y = r.root.y + 425 * s;
    const hit = r.hitTest(x, y);
    const region = r.regionAt(x, y);
    window.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, bubbles: true }));
    const el = r.soundPool.get('potHit') && r.soundPool.get('potHit').els[0];
    return {
      point: [Math.round(x), Math.round(y)],
      scale: Number(s.toFixed(3)),
      hit,
      region: region && region.id,
      lastSound: r.lastSound,
      playing: el ? !el.paused : null,
      time: el ? Number(el.currentTime.toFixed(3)) : null,
      ready: r.soundReady('potHit'),
    };
  })()`);
  console.log("[selftest] pot-sfx:", JSON.stringify(sfx));
  await wait(200);
  await snapshot(dir, "19-pot-sfx");
  const back = new Promise((r) => win.webContents.once("did-finish-load", () => r()));
  switchSkin("xi-01-wenrou");
  await back;
  await wait(900);
  console.log("[selftest] skin-back:", (await win.webContents.executeJavaScript("window.pet.getDebugState()")).skinId);
  if (chatHost) {
    await chatHost.demo();
    await wait(800);
    const demoTalking = await win.webContents.executeJavaScript("window.__rig.talking");
    console.log("[selftest] talk-from-bubble:", demoTalking === true);
    const wins = chatHost.debugWindows();
    const bubbleShot = wins.bubble && !wins.bubble.isDestroyed() ? await wins.bubble.webContents.capturePage() : null;
    if (bubbleShot) {
      import_node_fs2.default.writeFileSync(import_node_path3.default.join(dir, "20-bubble.png"), bubbleShot.toPNG());
      console.log("[selftest] 20-bubble");
    }
    const dialogShot = wins.dialog && !wins.dialog.isDestroyed() ? await wins.dialog.webContents.capturePage() : null;
    if (dialogShot) {
      import_node_fs2.default.writeFileSync(import_node_path3.default.join(dir, "21-dialog.png"), dialogShot.toPNG());
      console.log("[selftest] 21-dialog");
    }
    const chatState = chatHost.status();
    console.log("[selftest] chat:", JSON.stringify(chatState));
    chatHost.hideBubble();
    chatHost.closeDialog();
    await wait(300);
  }
  const menu = showContextMenu();
  await wait(450);
  menu?.closePopup(win);
  await wait(200);
  const dbg = await win.webContents.executeJavaScript("window.pet.getDebugState()");
  console.log("[selftest] context-menu: opened =", dbg.menuOpened);
  await win.webContents.executeJavaScript("window.pet.dragStart()");
  await wait(150);
  const dragOn = await win.webContents.executeJavaScript("window.pet.getDebugState()");
  await win.webContents.executeJavaScript("window.pet.dragEnd()");
  await wait(250);
  const dragOff = await win.webContents.executeJavaScript("window.pet.getDebugState()");
  console.log("[selftest] drag-state:", dragOn.dragging === true && dragOff.dragging === false);
  if (win) {
    const before2 = win.getBounds();
    startDrag();
    try {
      win.setSize(before2.width + 40, before2.height + 40);
    } catch {
    }
    await wait(120);
    const after2 = win.getBounds();
    stopDrag();
    const sizePinned = after2.width === before2.width && after2.height === before2.height;
    console.log("[selftest] drag-size-pin:", sizePinned, JSON.stringify({ before: `${before2.width}x${before2.height}`, after: `${after2.width}x${after2.height}` }));
    try {
      win.setBounds(before2);
    } catch {
    }
  }
  const wa = workArea();
  const { w, h } = computeWinSize(currentScale);
  win.setBounds({ x: wa.x + wa.width - w - 6, y: wa.y + wa.height - h - 6, width: w, height: h });
  snapToEdge();
  await wait(400);
  const [sx, sy] = win.getPosition();
  console.log(
    "[selftest] snap-to-edge:",
    sx === wa.x + wa.width - w && sy === wa.y + wa.height - h,
    JSON.stringify({ sx, sy })
  );
  console.log("[selftest] done");
  await wait(200);
  import_electron2.app.quit();
}
var pidFile = process.env.FEIYU_PET_PIDFILE || import_node_path3.default.join(appRoot(), "run.pid");
if (pidFile) {
  try {
    import_node_fs2.default.writeFileSync(pidFile, String(process.pid));
  } catch {
  }
}
import_electron2.app.whenReady().then(() => {
  if (!hasSingleInstance) return;
  settings = loadSettings();
  if (skinArg) {
    settings.skin = skinArg.slice("--skin=".length);
    console.log("[boot] skin override ->", settings.skin);
  }
  currentScale = settings.scale;
  console.log("[boot] scale =", currentScale);
  import_electron2.ipcMain.handle("skin:get", () => getSkin());
  import_electron2.ipcMain.handle("services:describe", () => describeServices());
  import_electron2.ipcMain.handle("pet:debug-state", () => ({
    ignore: debugIgnore,
    dragging: dragTimer !== null,
    pos: win?.getPosition() ?? null,
    menuOpened: menuOpenCount,
    sliderOpen: !!slider && !slider.isDestroyed(),
    skinId: getSkin().id,
    skinNames: listSkins().map((s) => s.name),
    chat: chatHost?.status() ?? null
  }));
  import_electron2.ipcMain.on("pet:drag-start", () => startDrag());
  import_electron2.ipcMain.on("pet:drag-end", () => {
    stopDrag();
    snapToEdge();
  });
  import_electron2.ipcMain.on("pet:quit", () => import_electron2.app.quit());
  import_electron2.ipcMain.on("pet:log", (_e, msg) => console.log("[renderer]", msg));
  import_electron2.ipcMain.on("pet:menu", () => showContextMenu());
  import_electron2.ipcMain.on("pet:input-mode-ack", () => {
  });
  import_electron2.ipcMain.on("pet:mask", (_e, payload) => {
    const { w, h } = payload;
    const bits = payload.bits instanceof Uint8Array ? payload.bits : Uint8Array.from(payload.bits);
    if (w > 0 && h > 0 && bits.length === w * h) {
      maskData = { w, h, bits };
      console.log("[mask] from renderer", w, "x", h);
    }
  });
  import_electron2.ipcMain.on("scale:preview", (_e, v) => applyScale(v, false));
  import_electron2.ipcMain.on("scale:commit", (_e, v) => applyScale(v, true));
  import_electron2.ipcMain.on("slider:close", () => slider?.close());
  console.log("[skin] available:", listSkins().map((s) => `${s.id}=${s.name}`).join(" | "));
  createWindow();
  chatHost = new ChatHost({
    distDir: __dirname,
    preload: import_node_path3.default.join(__dirname, "preload.js"),
    getPetWindow: () => win,
    onSpeak: (ms) => speakFor(ms),
    onModeChange: (mode) => {
      settings.dialogMode = mode;
      persistSettings();
    },
    onFocusChange: (enabled) => {
      settings.focusMode = enabled;
      persistSettings();
      refreshTrayMenu();
    },
    log: (...args) => console.log("[chat]", ...args)
  });
  chatHost.setInitialMode(settings.dialogMode === "voice" ? "voice" : "text");
  chatHost.setInitialFocus(settings.focusMode === true);
  chatHost.registerIpc(import_electron2.ipcMain);
  chatHost.start();
  createTray();
  if (isSelftest) {
    win?.webContents.once("did-finish-load", () => {
      runSelftest().catch((err) => {
        console.error("[selftest] failed", err);
        import_electron2.app.quit();
      });
    });
    return;
  }
  if (capturePath) {
    win?.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        if (!win) return;
        try {
          if (actionArg) {
            const action = actionArg.slice("--action=".length);
            if (action === "chat-text" || action === "chat-voice") {
              chatHost?.openDialog(action === "chat-voice" ? "voice" : "text");
              await wait(900);
            } else if (action === "mouth-open" || action === "mouth-closed") {
              const v = action === "mouth-open" ? 1 : 0;
              await win.webContents.executeJavaScript(`window.__rig && window.__rig.setMouthOverride(${v})`);
              await wait(650);
            } else if (action === "mouth") {
              send(action);
              await wait(600);
            } else {
              send(action);
              await wait(140);
            }
          }
          const img = await win.webContents.capturePage();
          const abs = import_node_path3.default.isAbsolute(capturePath) ? capturePath : import_node_path3.default.join(appRoot(), capturePath);
          import_node_fs2.default.mkdirSync(import_node_path3.default.dirname(abs), { recursive: true });
          import_node_fs2.default.writeFileSync(abs, img.toPNG());
          console.log("[capture]", abs);
        } catch (err) {
          console.error("[capture] failed", err);
        } finally {
          import_electron2.app.quit();
        }
      }, 1500);
    });
  }
});
import_electron2.app.on("window-all-closed", () => import_electron2.app.quit());
import_electron2.app.on("before-quit", () => {
  if (pidFile) {
    try {
      import_node_fs2.default.rmSync(pidFile, { force: true });
    } catch {
    }
  }
  stopDrag();
  if (inputPoll) clearInterval(inputPoll);
  if (snapTimer) clearInterval(snapTimer);
  if (talkTimer) clearTimeout(talkTimer);
  talkTimer = null;
  try {
    chatHost?.dispose();
  } catch {
  }
  chatHost = null;
});
//# sourceMappingURL=main.js.map
