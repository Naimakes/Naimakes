(function () {
  var boot = document.getElementById("boot");
  if (!boot) return;
  var settled = false;
  var timer = 0;
  var removeTimer = 0;
  var trickle = 0;
  var progress = 0;
  var CAP = 0.9;

  function setProgress(value) {
    value = Math.min(1, value);
    if (value <= progress) return;
    progress = value;
    boot.style.setProperty("--boot-progress", progress.toFixed(3));
  }
  function advance(share) {
    if (!settled) setProgress(progress + (CAP - progress) * share);
  }
  function stopTrickle() {
    clearInterval(trickle);
    window.removeEventListener("load", resourceLoaded, true);
  }
  function resourceLoaded(event) {
    var target = event.target;
    if (target === window || target === document) setProgress(Math.max(progress, 0.6));
    else if (target && /^(SCRIPT|LINK|IMG)$/.test(target.tagName)) advance(0.18);
  }

  function done() {
    if (settled) return;
    settled = true;
    stopTrickle();
    clearTimeout(timer);
    window.removeEventListener("error", resourceError, true);
    if (!boot.isConnected) return;
    setProgress(1);
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(function () {
      boot.classList.add("is-done");
      boot.addEventListener("transitionend", onTransitionEnd);
      removeTimer = setTimeout(remove, 900);
    }, reduce ? 0 : 420);
  }
  function onTransitionEnd(event) {
    if (event.target === boot && event.propertyName === "opacity") remove();
  }
  function remove() {
    clearTimeout(removeTimer);
    boot.removeEventListener("transitionend", onTransitionEnd);
    if (boot.isConnected) boot.remove();
  }
  function stuck(message) {
    if (settled || !boot.isConnected) return;
    stopTrickle();
    var slow = boot.querySelector(".boot-slow");
    if (!slow) return;
    boot.classList.add("is-stalled");
    boot.setAttribute("aria-label", "Naimakes 加载未完成，可以刷新重试");
    slow.style.animation = "none";
    slow.style.opacity = "1";
    slow.textContent = message + " ";
    var retry = document.createElement("a");
    retry.href = location.pathname + location.search + location.hash;
    retry.textContent = "刷新重试";
    slow.appendChild(retry);
  }

  setProgress(0.08);
  window.addEventListener("load", resourceLoaded, true);
  document.addEventListener("DOMContentLoaded", function () {
    setProgress(Math.max(progress, 0.35));
  });
  trickle = setInterval(function () { advance(0.035); }, 400);

  window.__nmkBootDone = done;
  timer = setTimeout(function () {
    stuck("加载时间超出预期，可能是网络暂时不稳定。");
  }, 20000);

  function resourceError(event) {
    var target = event.target;
    if (target && target !== window &&
      (target.tagName === "SCRIPT" || (target.tagName === "LINK" && target.rel === "stylesheet")))
      stuck("页面资源加载失败，请检查网络或稍后再试。");
  }
  window.addEventListener("error", resourceError, true);
})();
