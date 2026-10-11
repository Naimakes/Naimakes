import { dirname, resolve } from "node:path";

export const projectRoot = dirname(import.meta.dirname);
export const fromRoot = (...parts) => resolve(projectRoot, ...parts);
export const dirFromEnv = (value, ...fallback) =>
  value ? resolve(value) : fromRoot(...fallback);
