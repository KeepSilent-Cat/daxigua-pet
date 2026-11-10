"use strict";
(() => {
  // src/slider/index.ts
  var q = new URLSearchParams(location.search);
  var min = Number(q.get("min") ?? 0.2);
  var max = Number(q.get("max") ?? 0.62);
  var initial = Number(q.get("scale") ?? 0.44);
  var range = document.getElementById("r");
  var val = document.getElementById("val");
  range.min = String(min);
  range.max = String(max);
  range.step = "0.01";
  range.value = String(initial);
  var paint = () => {
    val.textContent = `${Math.round(Number(range.value) * 100)}%`;
  };
  paint();
  range.addEventListener("input", () => {
    paint();
    window.pet.setScale(Number(range.value), false);
  });
  range.addEventListener("change", () => {
    window.pet.setScale(Number(range.value), true);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.pet.closeSlider();
  });
  window.addEventListener("blur", () => {
    window.pet.closeSlider();
  });
})();
//# sourceMappingURL=slider.js.map
