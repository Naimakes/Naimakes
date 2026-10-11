import { nmkMarkSvg } from "../ui/nmk-logo";
import "./enter-forum.css";

type ConvergenceOptions = {
  host: HTMLElement;
  stage: HTMLElement;
  reduced: boolean;
  onDone: () => void;
};

const T = {
  mark: 1.2,
  settle: 3.7,
  heading: 4.7,
  action: 6.1,
};
const LEAVE = 0.9;

export class Convergence {
  readonly root: HTMLElement;
  private start = 0;
  private begun = false;
  private now = 0;
  private fired = new Set<string>();
  private leaving = -1;
  private done = false;
  private abort = new AbortController();
  private resizeObserver: ResizeObserver;
  private slot: HTMLElement;
  private button: HTMLButtonElement;

  constructor(private o: ConvergenceOptions) {
    this.root = document.createElement("section");
    this.root.className = "cv";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "欢迎来到 Naimakes 论坛");
    this.root.innerHTML = `
<div class="cv-light" aria-hidden="true"></div>
<div class="cv-frame">
  <div class="cv-lead">
    <p class="cv-eyebrow">WELCOME TO NAIMAKES</p>
    <h2 class="cv-heading">欢迎来到<br><span>Naimakes 论坛</span></h2>
    <div class="cv-sign">
      <div class="cv-mark-slot">${nmkMarkSvg({ fill: "#0b0b0b", className: "cv-mark", title: "Naimakes" })}</div>
      <p class="cv-tagline">思想，先于未来<small>IDEAS BEFORE THE FUTURE</small></p>
    </div>
  </div>
  <button type="button" class="cv-start" data-cv="start" inert>开启您的旅程 <span aria-hidden="true">→</span></button>
</div>`;
    o.host.append(this.root);
    o.host.dataset.ending = "open";
    o.stage.inert = true;
    if (o.reduced) this.root.classList.add("is-reduced");
    this.slot = this.root.querySelector(".cv-mark-slot")!;
    this.button = this.root.querySelector(".cv-start")!;
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(this.root);
    this.layout();
    this.button.addEventListener("click", () => this.enter(), { signal: this.abort.signal });
  }

  private layout() {
    const host = this.root.getBoundingClientRect();
    const slot = this.slot.getBoundingClientRect();
    if (!slot.width || !host.width) return;
    const centerWidth = Math.min(host.width * 0.42, host.height * 0.62, 620);
    const dx = host.left + host.width / 2 - (slot.left + slot.width / 2);
    const dy = host.top + host.height / 2 - (slot.top + slot.height / 2);
    this.root.style.setProperty("--mark-dx", `${dx.toFixed(1)}px`);
    this.root.style.setProperty("--mark-dy", `${dy.toFixed(1)}px`);
    this.root.style.setProperty("--mark-k", (centerWidth / slot.width).toFixed(4));
  }

  key(event: KeyboardEvent) {
    if (this.leaving >= 0) {
      event.preventDefault();
      return true;
    }
    const ready = this.fired.has("action");
    if (event.key === "Escape" && !ready) {
      event.preventDefault();
      this.seek(T.action);
    } else if ((event.key === "Enter" || event.key === " ") && event.target !== this.button) {
      event.preventDefault();
      if (ready) this.enter();
      else this.seek(T.action);
    }
    return true;
  }

  enter() {
    if (this.leaving >= 0 || !this.fired.has("action")) return;
    this.leaving = this.now;
    this.root.classList.add("is-leaving");
    this.o.host.dataset.ending = "leaving";
  }

  private elapsed() {
    return this.now - this.start;
  }

  private once(key: string, at: number, run: () => void) {
    if (this.fired.has(key) || this.elapsed() < at) return;
    this.fired.add(key);
    run();
  }

  tick(now: number) {
    this.now = now;
    if (!this.begun) {
      this.begun = true;
      this.start = this.o.reduced ? now - T.action : now;
      requestAnimationFrame(() => this.root.classList.add("is-open"));
    }
    if (this.leaving >= 0) {
      if (!this.done && now - this.leaving > (this.o.reduced ? 0 : LEAVE)) {
        this.done = true;
        this.o.onDone();
      }
      return;
    }
    this.once("mark", T.mark, () => {
      this.root.classList.add("show-mark");
    });
    this.once("settle", T.settle, () => this.root.classList.add("is-settled"));
    this.once("heading", T.heading, () => this.root.classList.add("show-heading"));
    this.once("action", T.action, () => {
      this.root.classList.add("show-action");
      this.button.inert = false;
      this.button.focus({ preventScroll: true });
    });
  }

  seek(t: number) {
    if (!this.begun) return;
    this.start = this.now - t;
    this.tick(this.now);
  }

  dispose() {
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.root.remove();
    delete this.o.host.dataset.ending;
    this.o.stage.inert = false;
  }
}
