#!/usr/bin/env node
// Zero-dependency checks for the static site in site/ (run: node scripts/check-site.mjs).
// - HTML: doctype, <html lang>, charset, viewport, title, meta description, balanced tags,
//   unique ids, one <h1>, no skipped heading levels, alt on every <img>, no inline scripts or
//   handlers (a page may load a script file from site/assets/, which must not use the network).
// - Links: every internal href/src resolves to a file in site/, and every #fragment exists.
// - Privacy: nothing is loaded from another origin (stylesheets, scripts, images, iframes…).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? "site");
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
// Elements whose end tag may be omitted in valid HTML; we still write them, but don't fail on it.
const OPTIONAL_END = new Set(["li", "p", "td", "th", "tr", "thead", "tbody", "dt", "dd", "option"]);

const errors = [];
const fail = (file, msg) => errors.push(`${relative(process.cwd(), file)}: ${msg}`);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(ROOT);
const pages = files.filter((f) => f.endsWith(".html"));
const idsByFile = new Map();

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return out;
}

function parse(file) {
  const src = readFileSync(file, "utf8");
  // Drop comments, then the contents of <pre>/<script>/<style> for tag balancing.
  const html = src.replace(/<!--[\s\S]*?-->/g, "");
  const tags = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*?)?)(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    tags.push({ close: m[1] === "/", name: m[2].toLowerCase(), attrs: attrs(m[3] ?? ""), raw: m[0], index: m.index });
  }
  return { src, html, tags };
}

for (const file of pages) {
  const { src, html, tags } = parse(file);
  if (!/^<!doctype html>/i.test(src.trimStart())) fail(file, "missing <!doctype html>");

  const htmlTag = tags.find((t) => !t.close && t.name === "html");
  if (!htmlTag?.attrs.lang) fail(file, "<html> has no lang");
  if (!tags.some((t) => t.name === "meta" && t.attrs.charset?.toLowerCase() === "utf-8")) fail(file, "missing <meta charset=utf-8>");
  if (!tags.some((t) => t.name === "meta" && t.attrs.name === "viewport")) fail(file, "missing viewport meta");
  if (!tags.some((t) => t.name === "meta" && t.attrs.name === "description" && t.attrs.content)) fail(file, "missing meta description");
  if (!/<title>[^<]+<\/title>/.test(html)) fail(file, "missing or empty <title>");
  if (!tags.some((t) => t.name === "main")) fail(file, "no <main> landmark");

  // Balanced tags.
  const stack = [];
  for (const t of tags) {
    if (VOID.has(t.name)) continue;
    if (!t.close) { stack.push(t.name); continue; }
    while (stack.length && stack.at(-1) !== t.name && OPTIONAL_END.has(stack.at(-1))) stack.pop();
    if (stack.at(-1) === t.name) stack.pop();
    else fail(file, `unexpected </${t.name}> (open: <${stack.at(-1) ?? "none"}>)`);
  }
  const left = stack.filter((n) => !OPTIONAL_END.has(n));
  if (left.length) fail(file, `unclosed tags: ${left.join(", ")}`);

  // Ids, headings, images, scripts.
  const ids = new Set();
  for (const t of tags) {
    if (t.close) continue;
    if (t.attrs.id !== undefined) {
      if (ids.has(t.attrs.id)) fail(file, `duplicate id "${t.attrs.id}"`);
      ids.add(t.attrs.id);
    }
    if (t.name === "img" && t.attrs.alt === undefined) fail(file, `<img src="${t.attrs.src}"> has no alt`);
    if (t.name === "script" && !(t.attrs.src?.startsWith("/assets/") && t.attrs.src.endsWith(".js"))) fail(file, "only script files from /assets/ are allowed, no inline scripts");
    if (Object.keys(t.attrs).some((a) => a.startsWith("on"))) fail(file, `inline event handler in ${t.raw}`);
  }
  idsByFile.set(file, ids);

  const levels = tags.filter((t) => !t.close && /^h[1-6]$/.test(t.name)).map((t) => Number(t.name[1]));
  if (levels.filter((l) => l === 1).length !== 1) fail(file, `expected exactly one <h1>, found ${levels.filter((l) => l === 1).length}`);
  levels.forEach((l, i) => { if (i > 0 && l > levels[i - 1] + 1) fail(file, `heading level skips from h${levels[i - 1]} to h${l}`); });
}

// Links and loaded resources.
const LOADS = { link: "href", script: "src", img: "src", iframe: "src", source: "src", video: "src", audio: "src", embed: "src", object: "data" };
let checked = 0;
for (const file of pages) {
  const { tags, src } = parse(file);
  if (/url\(\s*['"]?https?:/i.test(src)) fail(file, "inline style loads a remote url()");
  for (const t of tags) {
    if (t.close) continue;
    const loadAttr = LOADS[t.name];
    const isLoad = loadAttr && t.attrs[loadAttr] !== undefined && !(t.name === "link" && ["canonical"].includes(t.attrs.rel));
    const url = t.name === "a" ? t.attrs.href : isLoad ? t.attrs[loadAttr] : undefined;
    if (url === undefined) continue;
    if (/^[a-z]+:/i.test(url) || url.startsWith("//")) {
      if (isLoad) fail(file, `loads a resource from another origin: ${url}`);
      continue; // external links (https:, mailto:) are only links
    }
    checked++;
    const [pathPart, frag] = url.split("#");
    let target = file;
    if (pathPart) {
      target = pathPart.startsWith("/") ? join(ROOT, pathPart) : join(dirname(file), pathPart);
      if (pathPart.endsWith("/")) target = join(target, "index.html");
      else if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
      if (!existsSync(target)) { fail(file, `broken link: ${url}`); continue; }
    }
    if (frag && target.endsWith(".html") && !idsByFile.get(target)?.has(frag)) fail(file, `missing anchor: ${url}`);
  }
}

// CSS files must not load anything remote either.
for (const f of files.filter((f) => f.endsWith(".css"))) {
  const css = readFileSync(f, "utf8");
  if (/@import|url\(\s*['"]?(https?:)?\/\//i.test(css)) fail(f, "stylesheet imports or loads a remote resource");
}

// Script files: no inline content in pages (checked above), and no network use in the files.
for (const f of files.filter((f) => f.endsWith(".js"))) {
  const js = readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, "");
  const hit = js.match(/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|import\s*\(|https?:\/\/|document\.cookie|localStorage|sessionStorage/);
  if (hit) fail(f, `script uses the network or browser storage: ${hit[0]}`);
}
for (const file of pages) {
  if (/<script\b[^>]*>[^<]+<\/script>/i.test(readFileSync(file, "utf8"))) fail(file, "inline script content");
}

// Release placeholders are allowed while the download PR waits for the release, but are reported.
const pending = pages.filter((f) => /\b(TAG|SIZE|SHA256)-TBD\b/.test(readFileSync(f, "utf8")));
if (pending.length) console.log(`! Release placeholders still in: ${pending.map((f) => relative(process.cwd(), f)).join(", ")}`);

if (!existsSync(join(ROOT, "CNAME"))) errors.push("site/CNAME is missing");

console.log(`Checked ${pages.length} pages, ${checked} internal links and resources.`);
if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  process.exit(1);
}
console.log("✓ HTML structure, internal links and anchors OK; nothing loaded from another origin.");
