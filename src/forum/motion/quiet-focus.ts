let keyboardModality = false;
if (typeof window !== "undefined") {
  addEventListener("keydown", (event) => { if (event.key === "Tab" || event.key.startsWith("Arrow")) keyboardModality = true; }, true);
  addEventListener("pointerdown", () => { keyboardModality = false; }, true);
}
export function focusQuietly(target: HTMLElement) {
  if (keyboardModality) return target.focus({ preventScroll: true });
  target.setAttribute("data-focus-quiet", "");
  target.focus({ preventScroll: true });
  const clear = () => {
    target.removeAttribute("data-focus-quiet");
    target.removeEventListener("blur", clear);
    removeEventListener("keydown", clear, true);
  };
  target.addEventListener("blur", clear);
  addEventListener("keydown", clear, true);
}
