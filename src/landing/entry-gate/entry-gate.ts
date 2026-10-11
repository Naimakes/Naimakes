import { escapeHtml } from "../ui/escape-html";

type EntryUser = { id: string; name: string; initials?: string; avatar?: string };
export type EntryChoice = { user: EntryUser | null; skipOpening: boolean };

type View = "signin" | "signup" | "welcome";

type EntryOptions = {
  root: HTMLElement;
  logo: string;
  prime: () => void;
  unlock: () => Promise<void>;
  signedIn: (user: EntryUser) => void;
  start: (choice: EntryChoice) => void;
};

const SKIP_KEY = "naimakes-skip-opening";
const readSkip = () => {
  try {
    return localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
};
const writeSkip = (value: boolean) => {
  try {
    localStorage.setItem(SKIP_KEY, value ? "1" : "0");
  } catch {
  }
};

async function request<T>(path: string, init: RequestInit = {}, timeout = 20000): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      credentials: "same-origin",
      ...init,
      signal: AbortSignal.timeout(timeout),
      headers: { "Content-Type": "application/json", ...init.headers },
    });
  } catch (error) {
    throw new Error(
      (error as Error)?.name === "TimeoutError"
        ? "网络连接超时，请检查网络后重试。"
        : "网络连接失败，请检查网络后重试。",
    );
  }
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/json"))
    throw new Error("社区服务暂时不可用，请稍后重试。");
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(data.error || "暂时无法连接，请稍后重试。"), {
      status: response.status,
      code: data.code as string | undefined,
    });
  return data as T;
}

const COPY: Record<View, { eyebrow: string; title: string; lead: string; action: string }> = {
  signin: {
    eyebrow: "ACCESS PERMISSION REQUIRED",
    title: "很高兴，再次相遇。",
    lead: "登录 Naimakes，继续你的探索。",
    action: "登录",
  },
  signup: {
    eyebrow: "ACCESS PERMISSION REQUIRED",
    title: "让未来，多一种声音。",
    lead: "加入 Naimakes，与好奇的人一起探索。",
    action: "创建账号",
  },
  welcome: {
    eyebrow: "IDENTITY RECOGNIZED",
    title: "欢迎回来",
    lead: "确认身份，然后进入 Naimakes。",
    action: "进入",
  },
};

const arrow = '<span class="entry-arrow" aria-hidden="true">→</span>';
const spinner = '<span class="entry-spinner" aria-hidden="true"></span>';

export class StartupGate {
  private state: "loading" | "waiting" | "starting" | "started" = "loading";
  private assetsReady = false;
  private view: View = "signin";
  private user: EntryUser | null = null;
  private pending: EntryChoice | null = null;
  private busy = false;
  private takenName = "";
  private nameCheck = 0;
  private nameTimer: ReturnType<typeof setTimeout> | undefined;
  private card: HTMLElement;
  private form: HTMLFormElement;
  private nameInput: HTMLInputElement;
  private emailInput: HTMLInputElement;
  private passwordInput: HTMLInputElement;
  private submitButton: HTMLButtonElement;
  private continueButton: HTMLButtonElement;
  private skip: HTMLInputElement;
  private error: HTMLElement;
  private hint: HTMLElement;
  private status: HTMLElement;

  constructor(private options: EntryOptions) {
    const { root } = options;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "登录 Naimakes");
    root.classList.add("entry-gate");
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="entry-backdrop" aria-hidden="true">
        <svg class="entry-orbit" viewBox="-500 -500 1000 1000"><circle class="entry-ring" r="430"/><circle class="entry-ring is-faint" r="452"/><g class="entry-satellites"><circle cx="430" cy="0" r="7"/><circle cx="-430" cy="0" r="7"/></g></svg>
      </div>
      <section class="entry-card" data-view="signin" aria-labelledby="entry-title" aria-describedby="entry-lead">
        <header class="entry-head">
          <div class="entry-mark">${options.logo}</div>
          <p class="entry-eyebrow"></p>
          <div class="entry-identity" aria-hidden="true"></div>
          <h1 class="entry-title" id="entry-title"></h1>
          <p class="entry-lead" id="entry-lead"></p>
        </header>
        <div class="entry-tabs" role="tablist" aria-label="账号操作">
          <span class="entry-lens" aria-hidden="true"></span>
          <button type="button" role="tab" id="entry-tab-signin" aria-controls="entry-form" data-entry-view="signin">登录</button>
          <button type="button" role="tab" id="entry-tab-signup" aria-controls="entry-form" data-entry-view="signup">创建账号</button>
        </div>
        <form class="entry-form" id="entry-form" role="tabpanel" aria-labelledby="entry-tab-signin" novalidate>
          <div class="entry-reveal">
            <div>
              <label class="entry-field">
                <span>你的昵称</span>
                <input name="name" autocomplete="nickname" maxlength="24" placeholder="让大家如何称呼你" aria-describedby="entry-name-hint" />
              </label>
              <p class="entry-hint" id="entry-name-hint" role="status" aria-live="polite"></p>
            </div>
          </div>
          <label class="entry-field">
            <span class="entry-email-label"></span>
            <input name="email" maxlength="254" autocapitalize="off" spellcheck="false" />
          </label>
          <label class="entry-field">
            <span>密码</span>
            <input name="password" type="password" maxlength="128" />
          </label>
          <p class="entry-error" role="alert" hidden></p>
          <button class="entry-start entry-submit" type="submit"></button>
        </form>
        <div class="entry-welcome">
          <button class="entry-start entry-continue" type="button"></button>
        </div>
        <footer class="entry-foot">
          <button type="button" class="entry-link" data-entry-action="guest">以访客身份进入</button>
          <label class="entry-skip">
            <span>跳过开场</span>
            <input type="checkbox" role="switch" class="entry-switch" />
          </label>
        </footer>
        <p class="entry-status" role="status" aria-live="polite"></p>
        <i class="entry-progress" aria-hidden="true"></i>
      </section>`,
    );
    this.card = root.querySelector<HTMLElement>(".entry-card")!;
    this.form = root.querySelector<HTMLFormElement>(".entry-form")!;
    this.nameInput = this.form.querySelector<HTMLInputElement>('input[name="name"]')!;
    this.emailInput = this.form.querySelector<HTMLInputElement>('input[name="email"]')!;
    this.passwordInput = this.form.querySelector<HTMLInputElement>('input[name="password"]')!;
    this.submitButton = this.form.querySelector<HTMLButtonElement>(".entry-submit")!;
    this.continueButton = root.querySelector<HTMLButtonElement>(".entry-continue")!;
    this.skip = root.querySelector<HTMLInputElement>(".entry-switch")!;
    this.error = root.querySelector<HTMLElement>(".entry-error")!;
    this.hint = root.querySelector<HTMLElement>(".entry-hint")!;
    this.status = root.querySelector<HTMLElement>(".entry-status")!;
    this.skip.checked = readSkip();
    this.skip.addEventListener("change", () => writeSkip(this.skip.checked));

    root.addEventListener("click", (event) => {
      event.stopPropagation();
      const target = event.target as Element;
      const tab = target.closest<HTMLElement>("[data-entry-view]");
      if (tab) return this.setView(tab.dataset.entryView as View);
      const action = target.closest<HTMLElement>("[data-entry-action]")?.dataset.entryAction;
      if (action === "guest") this.enterAs(null);
      else if (action === "switch") {
        this.setView("signin");
        this.emailInput.focus({ preventScroll: true });
      } else if (action === "back" && this.user) this.setView("welcome");
    });
    root.addEventListener("keydown", (event) => {
      event.stopPropagation();
      const tab = (event.target as Element).closest<HTMLElement>('[role="tab"]');
      if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next: View = event.key === "Home" ? "signin" : event.key === "End" ? "signup" : this.view === "signin" ? "signup" : "signin";
        this.setView(next);
        root.querySelector<HTMLElement>(`[data-entry-view="${next}"]`)?.focus();
      }
    });
    this.continueButton.addEventListener("click", () => this.enterAs(this.user));
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.form.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      input.removeAttribute("aria-invalid");
      if (!this.error.hidden) this.showError("");
      if (input === this.nameInput) this.checkName();
    });
    this.card.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      const rect = this.card.getBoundingClientRect();
      this.card.style.setProperty("--entry-light-x", `${event.clientX - rect.left}px`);
      this.card.style.setProperty("--entry-light-y", `${event.clientY - rect.top}px`);
      this.card.dataset.lit = "true";
    });
    this.card.addEventListener("pointerleave", () => delete this.card.dataset.lit);

    this.render();
    void request<{ user: EntryUser | null }>("/me", {}, 6000)
      .then((r) => r.user, () => null)
      .then((user) => {
        if (this.state === "started") return;
        this.user = user;
        this.setView(user ? "welcome" : "signin");
        root.classList.add("has-entry");
        if (matchMedia("(pointer: fine)").matches)
          requestAnimationFrame(() =>
            (user ? this.continueButton : this.emailInput).focus({ preventScroll: true }),
          );
      });
  }

  ready() {
    this.assetsReady = true;
    if (this.state === "loading") this.state = "waiting";
    this.options.root.dataset.entry = "waiting";
    const pending = this.pending;
    this.pending = null;
    if (pending) void this.proceed(pending);
    else this.render();
  }

  private setView(view: View) {
    if (this.busy || this.pending || this.state === "starting" || this.state === "started") return;
    if (view === "welcome" && !this.user) view = "signin";
    if (view !== this.view) {
      this.showError("");
      this.passwordInput.value = "";
    }
    this.view = view;
    this.render();
  }

  private render() {
    const { view, user } = this;
    const copy = COPY[view];
    const working = this.busy || Boolean(this.pending) || this.state === "starting" || this.state === "started";
    this.card.dataset.view = view;
    this.card.querySelector(".entry-eyebrow")!.textContent = copy.eyebrow;
    this.card.querySelector(".entry-title")!.textContent =
      view === "welcome" && user ? `欢迎回来，${user.name}` : copy.title;
    this.card.querySelector(".entry-lead")!.textContent = copy.lead;
    const identity = this.card.querySelector<HTMLElement>(".entry-identity")!;
    identity.innerHTML = user
      ? user.avatar
        ? `<img src="${escapeHtml(user.avatar)}" alt="" />`
        : `<span>${escapeHtml(user.initials || Array.from(user.name).slice(0, 2).join("").toUpperCase())}</span>`
      : "";

    const signup = view === "signup";
    for (const tab of this.card.querySelectorAll<HTMLButtonElement>("[data-entry-view]")) {
      const active = tab.dataset.entryView === view;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    this.form.setAttribute("aria-labelledby", `entry-tab-${signup ? "signup" : "signin"}`);
    const reveal = this.card.querySelector<HTMLElement>(".entry-reveal")!;
    reveal.inert = !signup;
    this.nameInput.disabled = !signup;
    this.card.querySelector(".entry-email-label")!.textContent = signup ? "邮箱地址" : "邮箱 / 用户 ID";
    this.emailInput.type = signup ? "email" : "text";
    this.emailInput.autocomplete = signup ? "email" : "username";
    this.emailInput.placeholder = signup ? "you@example.com" : "输入邮箱或用户 ID";
    this.passwordInput.autocomplete = signup ? "new-password" : "current-password";
    this.passwordInput.placeholder = signup ? "至少 8 位字符" : "输入你的密码";
    this.card.querySelector<HTMLElement>(".entry-tabs")!.inert = view === "welcome";
    this.form.inert = view === "welcome";
    this.card.querySelector<HTMLElement>(".entry-welcome")!.inert = view !== "welcome";
    for (const input of [this.nameInput, this.emailInput, this.passwordInput]) input.readOnly = working;

    const link = this.card.querySelector<HTMLButtonElement>(".entry-link")!;
    if (view === "welcome") {
      link.dataset.entryAction = "switch";
      link.textContent = "切换账号";
    } else if (user) {
      link.dataset.entryAction = "back";
      link.textContent = `以 ${user.name} 的身份进入`;
    } else {
      link.dataset.entryAction = "guest";
      link.textContent = "以访客身份进入";
    }
    link.disabled = working;
    this.skip.disabled = working;

    const label = this.pending
      ? `${spinner}正在准备开场…`
      : this.state === "starting" || this.state === "started"
        ? `${spinner}正在进入…`
        : this.busy
          ? `${spinner}正在验证身份…`
          : `${copy.action}${arrow}`;
    for (const button of [this.submitButton, this.continueButton]) {
      button.innerHTML = label;
      if (working) button.setAttribute("aria-disabled", "true");
      else button.removeAttribute("aria-disabled");
    }
    this.card.setAttribute("aria-busy", String(working));
    this.status.textContent = this.pending
      ? "身份已确认，三维场景载入后开场随即开始。"
      : this.assetsReady
        ? ""
        : "正在载入三维场景，可以先登录。";
  }

  private showError(message: string) {
    this.error.textContent = message;
    this.error.hidden = !message;
  }

  private fail(message: string, input?: HTMLInputElement) {
    this.showError(message);
    if (input) {
      input.setAttribute("aria-invalid", "true");
      input.focus({ preventScroll: true });
    }
    this.card.classList.remove("is-shaking");
    void this.card.offsetWidth;
    this.card.classList.add("is-shaking");
  }

  private validate(signup: boolean): [string, HTMLInputElement] | null {
    const name = this.nameInput.value.trim();
    const email = this.emailInput.value.trim();
    const password = this.passwordInput.value;
    if (signup) {
      if (name.length < 2 || name.length > 24) return ["昵称需为 2–24 个字。", this.nameInput];
      if (this.takenName && name.toLowerCase() === this.takenName.toLowerCase())
        return ["此用户名已存在，请换一个。", this.nameInput];
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return ["请输入有效的邮箱地址。", this.emailInput];
      if (password.length < 8) return ["密码至少需要 8 位字符。", this.passwordInput];
    } else {
      if (!email) return ["请输入邮箱或用户 ID。", this.emailInput];
      if (!password) return ["请输入密码。", this.passwordInput];
    }
    return null;
  }

  private checkName() {
    clearTimeout(this.nameTimer);
    const request_ = ++this.nameCheck;
    const name = this.nameInput.value.trim();
    this.setHint("", "");
    if (name.length < 2 || name.length > 24) return;
    this.nameTimer = setTimeout(() => {
      void request<{ available: boolean }>(`/auth/name-available?name=${encodeURIComponent(name)}`, {}, 8000)
        .then((r) => {
          if (request_ !== this.nameCheck) return;
          if (r.available) this.setHint("这个用户名可以使用。", "ok");
          else {
            this.takenName = name;
            this.setHint("此用户名已存在，请换一个。", "taken");
          }
        })
        .catch(() => {
        });
    }, 380);
  }

  private setHint(text: string, tone: "" | "ok" | "taken") {
    this.hint.textContent = text;
    this.hint.dataset.tone = tone;
    if (tone === "taken") this.nameInput.setAttribute("aria-invalid", "true");
  }

  private async submit() {
    if (this.busy || this.pending || this.state === "starting" || this.state === "started") return;
    const signup = this.view === "signup";
    const invalid = this.validate(signup);
    if (invalid) return this.fail(...invalid);
    this.options.prime();
    this.busy = true;
    this.showError("");
    this.render();
    const body: Record<string, string> = {
      email: this.emailInput.value.trim(),
      password: this.passwordInput.value,
    };
    if (signup) body.name = this.nameInput.value.trim();
    try {
      const r = await request<{ user: EntryUser }>(`/auth/${signup ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      this.busy = false;
      this.user = r.user;
      this.passwordInput.value = "";
      this.options.signedIn(r.user);
      void this.proceed({ user: r.user, skipOpening: this.skip.checked });
    } catch (error) {
      this.busy = false;
      this.render();
      const e = error as Error & { code?: string };
      if (signup && e.code === "name_taken") {
        this.takenName = body.name;
        this.setHint("此用户名已存在，请换一个。", "taken");
        return this.fail(e.message, this.nameInput);
      }
      this.fail(e.message, signup ? undefined : this.passwordInput);
    }
  }

  private enterAs(user: EntryUser | null) {
    if (this.busy || this.pending || this.state === "starting" || this.state === "started") return;
    this.options.prime();
    void this.proceed({ user, skipOpening: this.skip.checked });
  }

  private async proceed(choice: EntryChoice) {
    if (this.state === "starting" || this.state === "started") return;
    if (!this.assetsReady) {
      this.pending = choice;
      this.render();
      return;
    }
    this.state = "starting";
    this.options.root.dataset.entry = "starting";
    this.render();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.options.unlock().catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 8000);
      }),
    ]);
    clearTimeout(timer);
    this.state = "started";
    this.options.start(choice);
  }
}
