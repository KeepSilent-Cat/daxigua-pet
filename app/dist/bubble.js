"use strict";
(() => {
  // src/bubble/index.ts
  var bubbleEl = document.getElementById("bubble");
  var textEl = document.getElementById("text");
  var tagEl = document.getElementById("tag");
  var replyBtn = document.getElementById("reply");
  var closeBtn = document.getElementById("close");
  var playBtn = document.getElementById("play");
  var playIcon = document.getElementById("playIcon");
  var durEl = document.getElementById("dur");
  var audioEl = document.getElementById("audio");
  var current = null;
  var sizeTimer = 0;
  function formatDuration(ms) {
    if (!ms || ms < 400) return "";
    const seconds = Math.round(ms / 100) / 10;
    return `${seconds}s`;
  }
  function reportSize() {
    if (sizeTimer) cancelAnimationFrame(sizeTimer);
    sizeTimer = requestAnimationFrame(() => {
      const root = document.getElementById("root");
      const height = Math.ceil((root?.getBoundingClientRect().height ?? 0) + 2);
      const width = Math.max(220, Math.ceil(window.innerWidth));
      if (height > 0) window.pet.bubble.resize(width, height);
    });
  }
  function setPlaying(playing) {
    playBtn.classList.toggle("playing", playing);
    playIcon.textContent = playing ? "\u275A\u275A" : "\u25B6";
  }
  function stopAudio() {
    try {
      audioEl.pause();
      audioEl.removeAttribute("src");
      audioEl.load();
    } catch {
    }
    setPlaying(false);
  }
  async function playAudio() {
    if (!current?.audio?.url) return;
    try {
      window.pet.bubble.audioStarted();
      if (audioEl.src !== current.audio.url) audioEl.src = current.audio.url;
      await audioEl.play();
    } catch {
      setPlaying(false);
    }
  }
  function show(payload) {
    current = payload;
    textEl.textContent = payload.text;
    tagEl.classList.toggle("hidden", !payload.proactive);
    bubbleEl.classList.remove("out");
    bubbleEl.classList.add("in");
    stopAudio();
    if (payload.modality === "voice" && payload.audio?.url) {
      playBtn.classList.remove("hidden");
      durEl.textContent = formatDuration(Number(payload.audio.durationMs) || 0);
      audioEl.src = payload.audio.url;
      if (payload.autoplay !== false) void playAudio();
    } else {
      playBtn.classList.add("hidden");
      durEl.textContent = "";
    }
    reportSize();
    setTimeout(reportSize, 80);
  }
  function hide() {
    bubbleEl.classList.remove("in");
    bubbleEl.classList.add("out");
    stopAudio();
  }
  replyBtn.addEventListener("click", () => {
    if (!current) return;
    window.pet.bubble.action("reply", current.messageId);
  });
  closeBtn.addEventListener("click", () => {
    window.pet.bubble.action("close");
    hide();
  });
  playBtn.addEventListener("click", () => {
    if (audioEl.paused) void playAudio();
    else {
      audioEl.pause();
      setPlaying(false);
    }
  });
  audioEl.addEventListener("play", () => setPlaying(true));
  audioEl.addEventListener("pause", () => setPlaying(false));
  audioEl.addEventListener("ended", () => setPlaying(false));
  audioEl.addEventListener("error", () => setPlaying(false));
  document.body.addEventListener("mouseenter", () => window.pet.bubble.hover(true));
  document.body.addEventListener("mouseleave", () => window.pet.bubble.hover(false));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      window.pet.bubble.action("close");
      hide();
    }
  });
  window.addEventListener("resize", reportSize);
  window.pet.bubble.onShow(show);
  window.pet.bubble.onHide(hide);
  window.pet.bubble.onPauseAudio(() => {
    try {
      audioEl.pause();
    } catch {
    }
    setPlaying(false);
  });
  window.pet.bubble.ready();
})();
//# sourceMappingURL=bubble.js.map
