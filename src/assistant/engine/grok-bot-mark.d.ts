export type MarkTheme = "light" | "dark" | "auto";
export type PokeKind = "spin" | "bounce" | "nod";

export type MarkOptions = {
  size?: number | string;
  color?: string;
  eyeColor?: string;
  face?: string | null;
  state?: string;
  follow?: boolean;
  hover?: boolean;
  clickPoke?: boolean;
  autoBlink?: boolean;
  maxFrameRate?: number;
  paused?: boolean;
  reducedMotion?: "auto" | boolean;
  shape?: string;
  theme?: MarkTheme;
  look?: "flat" | "shaded" | "glow";
  fit?: "auto" | "none" | number;
  emphasis?: boolean;
};

export type MarkInstance = {
  readonly element: HTMLElement;
  readonly state: string;
  readonly face: string;
  readonly compact: boolean;
  readonly reducedMotion: boolean;
  setState(name: string): MarkInstance;
  setFace(name: string | null): MarkInstance;
  setShape(name: string): MarkInstance;
  setColor(color: string): MarkInstance;
  setEyeColor(color: string | undefined): MarkInstance;
  setTheme(theme: MarkTheme): MarkInstance;
  setSize(size: number | string): MarkInstance;
  setFollow(on: boolean): MarkInstance;
  setEmphasis(on: boolean): MarkInstance;
  setAutoBlink(on: boolean): MarkInstance;
  setClickPoke(on: boolean): MarkInstance;
  poke(kind?: PokeKind, options?: { turns?: number }): MarkInstance;
  look(direction: "left" | "right" | "up" | "down" | "center"): MarkInstance;
  gaze(point: [number, number] | null): MarkInstance;
  blink(): MarkInstance;
  pause(): MarkInstance;
  play(): MarkInstance;
  destroy(): void;
};

export type StillOptions = { shape: string; size?: number; ink?: string | { light: string; dark: string }; id?: string; fill?: number };

export declare const GrokBotMark: {
  version: string;
  mount(target: Element | string, options?: MarkOptions): MarkInstance;
  FACES: string[];
  STATES: string[];
  POKES: PokeKind[];
  SHAPES: string[];
  COLORS: string[];
  PALETTE: Record<string, { light: string; dark: string }>;
  SWATCHES: Record<string, string>;
  EMOTIONS: string[];
  stillSVG(options: StillOptions): string;
  stillDataURI(options: StillOptions): string;
};

export declare const mount: typeof GrokBotMark.mount;
export default GrokBotMark;
