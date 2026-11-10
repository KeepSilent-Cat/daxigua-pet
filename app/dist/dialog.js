"use strict";
(() => {
  // src/dialog/index.ts
  var el = (id) => document.getElementById(id);
  var messagesEl = el("messages");
  var inputEl = el("input");
  var sendBtn = el("send");
  var closeBtn = el("close");
  var nameEl = el("name");
  var dotEl = el("dot");
  var statusEl = el("status");
  var typingEl = el("typing");
  var bannerEl = el("banner");
  var bannerTextEl = el("bannerText");
  var retryBtn = el("retry");
  var dismissBtn = el("dismiss");
  var hintEl = el("hint");
  var modesEl = el("modes");
  var player = el("player");
  var queryMode = new URLSearchParams(location.search).get("mode");
  var mode = queryMode === "voice" ? "voice" : "text";
  var state = { connected: false, error: "", config: null };
  var messages = [];
  var sending = false;
  var playingId = "";
  var buttons = /* @__PURE__ */ new Map();
  var bannerTimer = null;
  var roleNameOverride = "";
  function formatTime(at) {
    try {
      return new Date(at).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }
  function formatDuration(ms) {
    if (!ms || ms < 400) return "\u8BED\u97F3";
    return `\u8BED\u97F3 ${(Math.round(ms / 100) / 10).toFixed(1)}s`;
  }
  function roleName() {
    return state.config?.role?.name || roleNameOverride || "\u5C0F\u80A5\u9C7C";
  }
  function setStatus() {
    const connected = state.connected;
    dotEl.classList.toggle("ok", connected);
    dotEl.classList.toggle("bad", !connected);
    nameEl.textContent = roleName();
    const modeText = mode === "voice" ? "\u8BED\u97F3\u5BF9\u8BDD" : "\u6587\u672C\u5BF9\u8BDD";
    statusEl.textContent = connected ? `\u5DF2\u8FDE\u63A5 SurfCore \xB7 ${modeText}` : state.error || "\u6CA1\u8FDE\u4E0A SurfCore";
    statusEl.title = connected ? "" : state.error || "";
  }
  function applyMode(next, notify = true) {
    mode = next === "voice" ? "voice" : "text";
    for (const button of modesEl.querySelectorAll(".mode")) {
      button.classList.toggle("on", button.dataset.mode === mode);
    }
    hintEl.textContent = mode === "voice" ? "\u8BED\u97F3\u5BF9\u8BDD\uFF1A\u5979\u7684\u56DE\u590D\u4F1A\u5FF5\u51FA\u6765\uFF0C\u6C14\u6CE1\u91CC\u4E5F\u4F1A\u663E\u793A\u6587\u5B57" : "\u6587\u672C\u5BF9\u8BDD\uFF1A\u5979\u7684\u56DE\u590D\u4F1A\u51FA\u73B0\u5728\u6C14\u6CE1\u91CC";
    inputEl.placeholder = mode === "voice" ? "\u8BF4\u70B9\u4EC0\u4E48\u2026\uFF08\u4F1A\u7528\u8BED\u97F3\u56DE\u4F60\uFF09" : "\u8DDF\u5979\u8BF4\u70B9\u4EC0\u4E48\u2026";
    setStatus();
    if (notify) window.pet.chat.setMode(mode);
  }
  function scrollToBottom(force = false) {
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
    if (force || nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function setTyping(pending) {
    typingEl.classList.toggle("hidden", !pending);
  }
  function showBanner(text) {
    bannerTextEl.textContent = text;
    bannerEl.classList.remove("hidden");
    if (bannerTimer) window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => hideBanner(), 9e3);
  }
  function hideBanner() {
    bannerEl.classList.add("hidden");
    if (bannerTimer) window.clearTimeout(bannerTimer);
    bannerTimer = null;
  }
  function setPlaying(id) {
    playingId = id;
    for (const [key, button] of buttons) {
      button.classList.toggle("playing", key === id);
    }
  }
  function playMessage(message) {
    if (!message.audio?.url) return;
    if (playingId === message.id) {
      player.pause();
      return;
    }
    try {
      window.pet.chat.audioStarted();
      player.src = message.audio.url;
      void player.play().catch(() => setPlaying(""));
      setPlaying(message.id);
    } catch {
      setPlaying("");
    }
  }
  player.addEventListener("ended", () => setPlaying(""));
  player.addEventListener("pause", () => setPlaying(""));
  player.addEventListener("error", () => setPlaying(""));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    try {
      player.pause();
    } catch {
    }
    setPlaying("");
  });
  function makeVoiceRow(message) {
    if (!message.audio?.url) return null;
    const row = document.createElement("div");
    row.className = "voice-row";
    const button = document.createElement("button");
    button.className = "voice-play";
    button.type = "button";
    const icon = document.createElement("span");
    icon.className = "wave";
    icon.innerHTML = "<i></i><i></i><i></i><i></i>";
    const label = document.createElement("span");
    label.textContent = formatDuration(Number(message.audio.durationMs) || 0);
    button.append(icon, label);
    button.addEventListener("click", () => playMessage(message));
    buttons.set(message.id, button);
    row.append(button);
    return row;
  }
  function renderMessage(message, opts = {}) {
    const mine = message.role === "user";
    const row = document.createElement("div");
    row.className = `row${mine ? " me" : ""}`;
    row.dataset.id = message.id;
    if (!mine) {
      const avatar = document.createElement("div");
      avatar.className = "mini-avatar";
      { const __im = document.createElement("img"); __im.src = "./avatar.png"; __im.alt = ""; avatar.appendChild(__im); }
      row.append(avatar);
    }
    const wrap = document.createElement("div");
    wrap.className = "bubble-wrap";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.text;
    const voiceRow = makeVoiceRow(message);
    if (voiceRow) bubble.append(voiceRow);
    wrap.append(bubble);
    const meta = document.createElement("div");
    meta.className = "meta";
    if (!mine && message.proactive) {
      const tag = document.createElement("span");
      tag.className = "tag-proactive";
      tag.textContent = "\u4E3B\u52A8\u627E\u4F60";
      meta.append(tag);
    }
    if (!mine && message.modality === "voice") {
      const tag = document.createElement("span");
      tag.textContent = "\u8BED\u97F3";
      meta.append(tag);
    }
    const time = document.createElement("span");
    time.textContent = formatTime(message.at);
    meta.append(time);
    wrap.append(meta);
    row.append(wrap);
    messagesEl.append(row);
    scrollToBottom(true);
    if (!mine && opts.autoplay && message.modality === "voice" && message.audio?.url && !document.hidden) {
      window.setTimeout(() => playMessage(message), 120);
    }
  }
  function addMessage(message, opts = {}) {
    if (!message?.id || messages.some((m) => m.id === message.id)) return;
    messages.push(message);
    if (messages.length > 300) messages = messages.slice(-300);
    renderMessage(message, opts);
  }
  function renderAll(items) {
    messages = [];
    buttons.clear();
    messagesEl.innerHTML = "";
    for (const message of items) {
      if (!message?.id) continue;
      if (messages.some((m) => m.id === message.id)) continue;
      messages.push(message);
      renderMessage(message, {});
    }
    scrollToBottom(true);
  }
  function autoGrow() {
    inputEl.style.height = "auto";
    inputEl.style.height = `${Math.min(110, Math.max(34, inputEl.scrollHeight))}px`;
  }
  async function send() {
    const text = inputEl.value.trim();
    if (!text || sending) return;
    if (!state.connected) {
      showBanner(state.error || "\u8FD8\u6CA1\u8FDE\u4E0A SurfCore\uFF1A\u5148\u5728 SurfCore \u8BBE\u7F6E \u2192 \u684C\u5BA0 \u91CC\u542F\u52A8\u4E00\u6B21");
      return;
    }
    const local = {
      id: `local-${Date.now()}`,
      role: "user",
      text,
      modality: mode,
      at: Date.now()
    };
    addMessage(local);
    inputEl.value = "";
    autoGrow();
    sending = true;
    sendBtn.disabled = true;
    setTyping(true);
    try {
      const result = await window.pet.chat.send(text, mode);
      if (!result?.ok) {
        setTyping(false);
        showBanner(result?.error || "\u53D1\u9001\u5931\u8D25");
      }
    } catch (error) {
      setTyping(false);
      showBanner(String(error?.message ?? error));
    } finally {
      sending = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }
  async function loadHistory() {
    try {
      const history = await window.pet.chat.history();
      state = { connected: history.connected, error: history.error, config: history.config };
      roleNameOverride = history.role?.name || "";
      setStatus();
      renderAll(Array.isArray(history.messages) ? history.messages : []);
      setTyping(Boolean(history.pending));
      if (!history.connected) {
        showBanner(history.error || "\u8FDE\u4E0D\u4E0A SurfCore\uFF1A\u5148\u5728\u8BBE\u7F6E \u2192 \u684C\u5BA0 \u91CC\u542F\u52A8\uFF0C\u518D\u70B9\u300C\u91CD\u8FDE\u300D");
      }
    } catch (error) {
      state = { ...state, connected: false, error: String(error?.message ?? error) };
      setStatus();
      showBanner(state.error);
    }
  }
  modesEl.addEventListener("click", (event) => {
    const target = event.target?.closest(".mode");
    if (!target) return;
    applyMode(target.dataset.mode === "voice" ? "voice" : "text", true);
    inputEl.focus();
  });
  sendBtn.addEventListener("click", () => {
    void send();
  });
  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  });
  inputEl.addEventListener("input", autoGrow);
  closeBtn.addEventListener("click", () => window.pet.chat.close());
  retryBtn.addEventListener("click", () => {
    hideBanner();
    window.pet.chat.reconnect();
    showBanner("\u6B63\u5728\u91CD\u8FDE\u2026");
  });
  dismissBtn.addEventListener("click", hideBanner);
  window.pet.chat.onState((next) => {
    const wasConnected = state.connected;
    state = next;
    setStatus();
    if (next.connected && !wasConnected) hideBanner();
    if (!next.connected) {
      showBanner(next.error || "\u8FDE\u4E0D\u4E0A SurfCore");
    }
  });
  window.pet.chat.onMode((payload) => applyMode(payload.mode, false));
  window.pet.chat.onMessage((message) => {
    if (!message) return;
    addMessage(message, { autoplay: true });
    setTyping(false);
  });
  window.pet.chat.onTyping((payload) => setTyping(Boolean(payload.pending)));
  window.pet.chat.onError((payload) => {
    setTyping(false);
    showBanner(payload?.message || "\u51FA\u9519\u4E86");
  });
  window.pet.chat.onFocusInput(() => {
    inputEl.focus();
    inputEl.select();
  });
  window.pet.chat.onPauseAudio(() => {
    try {
      player.pause();
    } catch {
    }
    setPlaying("");
  });
  applyMode(mode, false);
  setStatus();
  void loadHistory().then(() => inputEl.focus());
})();
//# sourceMappingURL=dialog.js.map
