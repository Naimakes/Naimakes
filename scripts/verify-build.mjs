import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";

export function verifyProductionBuild(projectRoot) {
  const root = resolve(projectRoot, "dist");
  const errors = [];
  const files = [];
  const walk = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  walk(root);
  for (const name of ["index.html", "landing.html", "loading-screen.js", "favicon.svg"])
    if (!existsSync(resolve(root, name))) errors.push(`Missing dist/${name}; run npm run build.`);
  if (!files.some((file) => file.endsWith(".js") && relative(root, file).startsWith(`assets${sep}`)))
    errors.push("Production JavaScript assets are missing; run npm run build.");

  const verifyReference = (reference, parent) => {
    if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return;
    let pathname;
    try { pathname = decodeURIComponent(reference.split(/[?#]/)[0]); }
    catch { errors.push(`Invalid resource URL in ${relative(projectRoot, parent)}`); return; }
    if (!pathname) return;
    const target = pathname.startsWith("/") ? resolve(root, `.${pathname}`) : resolve(dirname(parent), pathname);
    if (target !== root && !target.startsWith(root + sep)) {
      errors.push(`Resource escapes dist: ${reference}`);
      return;
    }
    if (!existsSync(target) || !statSync(target).isFile())
      errors.push(`${relative(projectRoot, parent)} references missing ${reference}`);
  };
  for (const file of files) {
    const extension = extname(file);
    if (![".html", ".js", ".css"].includes(extension)) continue;
    const content = readFileSync(file, "utf8");
    if (extension === ".html")
      for (const match of content.matchAll(/<(?:script|link|img|source)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/g))
        verifyReference(match[1], file);
    if (extension === ".js") {
      for (const match of content.matchAll(/\b(?:import|export)\s*(?:[^;"'\n]*?\bfrom\s*)?["'](\.[^"']+|\/[^"']+)["']|\bimport\s*\(\s*["'](\.[^"']+|\/[^"']+)["']/g))
        verifyReference(match[1] || match[2], file);
      for (const match of content.matchAll(/["'](\/assets\/[^"']+\.(?:png|jpe?g|webp|svg|gif|avif|woff2?|mp4|webm))["']/g))
        verifyReference(match[1], file);
    }
    if (extension === ".css")
      for (const match of content.replace(/url\(\s*(?:"data:[^"]*"|'data:[^']*'|data:[^)]*)\s*\)/g, "").matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g))
        verifyReference(match[1], file);
  }

  const publicRoot = resolve(projectRoot, "public");
  const publicFiles = [];
  const collectPublic = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) collectPublic(path);
      else if (entry.isFile()) publicFiles.push(path);
    }
  };
  collectPublic(publicRoot);
  for (const file of publicFiles) {
    const built = resolve(root, relative(publicRoot, file));
    if (!existsSync(built)) errors.push(`Public file missing from build: ${relative(publicRoot, file)}`);
    else if (!readFileSync(file).equals(readFileSync(built)))
      errors.push(`Public file changed since build: ${relative(publicRoot, file)}; rebuild before delivery.`);
  }
  return { files: files.map((file) => relative(projectRoot, file)), errors: [...new Set(errors)] };
}
