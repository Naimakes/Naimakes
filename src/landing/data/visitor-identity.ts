const FALLBACK = "NAIMAKES";
let identity = FALLBACK;

export function bootIdentity() {
  return identity;
}

export function setBootIdentity(name: string | null | undefined) {
  identity = (name ?? "").replace(/\s+/g, " ").trim() || FALLBACK;
}
