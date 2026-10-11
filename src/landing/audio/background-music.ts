import atmosphereUrl from "./atmosphere.ogg?url";
import motifUrl from "./motif.ogg?url";
import pulseUrl from "./pulse.ogg?url";
type SoundScene = "boot" | "archive" | "detail";
const STEMS = [atmosphereUrl, motifUrl, pulseUrl];
const LOOP_SECONDS = 160 / 3;
const MUSIC_VOLUME = 0.5;
const level = (
  param: AudioParam,
  value: number,
  now: number,
  seconds = 0.05,
) => {
  param.cancelAndHoldAtTime(now);
  param.linearRampToValueAtTime(value, now + seconds);
};
export class TerminalAudio {
  private context?: AudioContext;
  private musicBus?: GainNode;
  private stemGains: GainNode[] = [];
  private buffers?: AudioBuffer[];
  private loading?: Promise<void>;
  private fetching?: Promise<ArrayBuffer[]>;
  private musicData?: ArrayBuffer[];
  private tracks: AudioBufferSourceNode[] = [];
  private scene: SoundScene = "boot";
  private offset = 0;
  private startedAt = 0;
  private unlocked = false;
  private requestId = 0;
  private suspension: Promise<void> = Promise.resolve();
  private bootMix = -1;
  private entryPending = false;
  constructor() {
    document.addEventListener("pointerdown", this.gesture, { capture: true });
    document.addEventListener("keydown", this.gesture, { capture: true });
    document.addEventListener("visibilitychange", this.visibility);
    window.addEventListener("pagehide", this.hide);
    window.addEventListener("pageshow", this.visibility);
  }
  private gesture = () => {
    if (this.entryPending) return;
    this.unlocked = true;
    void this.activate();
  };
  holdForEntry() {
    this.entryPending = true;
  }
  releaseEntry() {
    this.entryPending = false;
  }
  async unlock() {
    this.unlocked = true;
    await this.activate();
  }
  prime() {
    try {
      const c = this.context ?? this.createContext();
      if (c.state !== "running") void c.resume().catch(() => {});
    } catch {}
  }
  prepareMusic() {
    if (this.musicData) return Promise.resolve(this.musicData);
    this.fetching ??= Promise.all(STEMS.map(async url => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Music ${url}: ${response.status}`);
        return await response.arrayBuffer();
      } finally { clearTimeout(timeout); }
    })).then(data => this.musicData = data).finally(() => { this.fetching = undefined; });
    return this.fetching;
  }
  restartBoot() {
    this.bootMix = -1;
  }
  private hide = () => {
    this.requestId++;
    this.stopMusic();
    this.suspension =
      this.context?.suspend().catch(() => {}) ?? Promise.resolve();
  };
  private visibility = () => {
    if (document.hidden) this.hide();
    else if (this.unlocked && !this.entryPending) void this.activate();
  };
  private createContext() {
    const c = (this.context = new AudioContext()),
      master = c.createGain(),
      limiter = c.createDynamicsCompressor();
    master.gain.value = 0.8;
    limiter.threshold.value = -8;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    this.musicBus = c.createGain();
    this.musicBus.gain.value = MUSIC_VOLUME;
    this.musicBus.connect(master);
    master.connect(limiter);
    limiter.connect(c.destination);
    this.stemGains = STEMS.map(() => {
      const gain = c.createGain();
      gain.gain.value = 0;
      gain.connect(this.musicBus!);
      return gain;
    });
    this.mixScene();
    return c;
  }
  private async activate() {
    if (document.hidden || !this.unlocked) return;
    const id = ++this.requestId;
    try {
      const c = this.context ?? this.createContext();
      const resume = c.state === "running" ? Promise.resolve() : c.resume();
      await Promise.all([this.suspension, resume]);
      if (id !== this.requestId || document.hidden || c.state !== "running") return;
      await this.loadMusic(c);
      if (id === this.requestId) this.startMusic();
    } catch {}
  }
  private loadMusic(c: AudioContext) {
    if (this.buffers) return Promise.resolve();
    this.loading ??= this.prepareMusic()
      .then(data => Promise.all(data.map(bytes => c.decodeAudioData(bytes.slice(0)))))
      .then((buffers) => {
        this.buffers = buffers;
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }
  private startMusic() {
    const c = this.context;
    if (!c || c.state !== "running" || !this.buffers || this.tracks.length || document.hidden) return;
    this.startedAt = c.currentTime + 0.04;
    this.tracks = this.buffers.map((buffer, i) => {
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = Math.min(LOOP_SECONDS, buffer.duration);
      src.connect(this.stemGains[i]);
      src.start(this.startedAt, this.offset % src.loopEnd);
      return src;
    });
    this.musicBus!.gain.cancelScheduledValues(c.currentTime);
    this.musicBus!.gain.setValueAtTime(0, c.currentTime);
    this.musicBus!.gain.linearRampToValueAtTime(MUSIC_VOLUME, c.currentTime + 1.2);
  }
  private stopMusic() {
    const c = this.context;
    if (!c || !this.tracks.length) return;
    this.offset =
      (this.offset + Math.max(0, c.currentTime - this.startedAt)) %
      LOOP_SECONDS;
    this.tracks.forEach((track, i) => {
      const fade = c.createGain();
      track.disconnect();
      track.connect(fade);
      fade.connect(this.stemGains[i]);
      fade.gain.setValueAtTime(1, c.currentTime);
      fade.gain.linearRampToValueAtTime(0, c.currentTime + 0.06);
      track.stop(c.currentTime + 0.07);
      track.onended = () => {
        track.disconnect();
        fade.disconnect();
      };
    });
    this.tracks = [];
  }
  setScene(scene: SoundScene) {
    if (this.scene === scene) return;
    this.scene = scene;
    this.bootMix = -1;
    this.mixScene();
  }
  private mixScene() {
    if (!this.context) return;
    const gains = {
      boot: [0.48, 0.32, 0.18],
      archive: [0.9, 0.72, 0.65],
      detail: [0.72, 0.36, 0.12],
    }[this.scene];
    this.stemGains.forEach((g, i) =>
      level(g.gain, gains[i], this.context!.currentTime, 1.1),
    );
  }
  updateBoot(appTime: number) {
    const time = appTime + 5;
    const phase = time < 22.76 ? 0 : time < 26.92 ? 1 : time < 34.3 ? 2 : 3;
    if (phase !== this.bootMix && this.context) {
      this.bootMix = phase;
      const gains = [
        [0.48, 0.32, 0.18],
        [0.68, 0.55, 0.32],
        [0.9, 0.72, 0.65],
        [0.72, 0.36, 0.12],
      ][phase];
      this.stemGains.forEach((g, i) =>
        level(g.gain, gains[i], this.context!.currentTime, 0.9),
      );
    }
  }
}
