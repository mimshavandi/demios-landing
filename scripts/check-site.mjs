#!/usr/bin/env node
// Zero-dependency checks for the static site in site/ (run: node scripts/check-site.mjs).
// - HTML: doctype, <html lang>, charset, viewport, title, meta description, balanced tags,
//   unique ids, one <h1>, no skipped heading levels, alt on every <img>, no inline scripts.
// - Links: every internal href/src resolves to a file in site/, and every #fragment exists.
// - Privacy: nothing is loaded from another origin (stylesheets, scripts, images, iframes…).
// - Design: copied app tokens match scripts/design-source.json; no raw style values (ratchet).
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, dirname, resolve } from "node:path";

const ROOT = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "site");
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
    if (t.name === "script") fail(file, "scripts are not allowed on this site");
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

// Design tokens: the copied app files must match scripts/design-source.json (no hand edits;
// re-run scripts/sync-design.mjs to update them).
const sourceFile = resolve(dirname(new URL(import.meta.url).pathname), "design-source.json");
if (!existsSync(sourceFile)) errors.push("scripts/design-source.json is missing");
else {
  const source = JSON.parse(readFileSync(sourceFile, "utf8"));
  for (const [to, { sha256 }] of Object.entries(source.files)) {
    const f = resolve(ROOT, "..", to);
    if (!existsSync(f)) { fail(f, "is missing (listed in scripts/design-source.json)"); continue; }
    if (createHash("sha256").update(readFileSync(f)).digest("hex") !== sha256)
      fail(f, `differs from ${source.repo}@${source.commit.slice(0, 7)}; don't edit it, run scripts/sync-design.mjs`);
  }
}

// Style ratchet, like the app's lint-ui (T-DES-02): colours, type sizes, spacing, radii, shadows
// and z-order come from tokens, never raw values. Applies to every stylesheet except the copied
// tokens.css, and to style="" attributes. scripts/style-baseline.json holds the allowed count per
// file and rule; a count may only go down. Hairlines (1px) and media queries are allowed.
const STYLE_RULES = {
  "raw-color": (l) => /(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?![\w-])|\b(?:rgba?|hsla?)\(/.test(l),
  "raw-font-size": (l) => /\bfont(?:-size)?\s*:[^;]*?(?<![\w.-])\d*\.?\d+(?:px|rem|em|pt)\b/.test(l),
  "raw-line-height": (l) => /\bline-height\s*:\s*(?!var\(|inherit|normal)[\d.]/.test(l),
  "raw-spacing": (l) => [...l.matchAll(/\b(?:margin|padding|gap|row-gap|column-gap|inset|top|left|right|bottom)(?:-[a-z]+)?\s*:([^;}]*)/g)]
    .some((d) => [...d[1].matchAll(/(?<![\w.-])-?(\d*\.?\d+)(px|rem|em)\b/g)].some((x) => x[2] !== "px" || Number(x[1]) > 1)),
  "raw-size": (l) => /\b(?:min-|max-)?(?:width|height)\s*:[^;]*?(?<![\w.-])\d*\.?\d+(?:px|rem|em)\b/.test(l),
  "raw-radius": (l) => /\bborder(?:-[a-z]+)*-radius\s*:[^;]*?(?<![\w.-])\d*[1-9]\d*(?:px|rem|em)/.test(l),
  "raw-z-index": (l) => /\bz-index\s*:\s*-?\d+/.test(l),
  "raw-shadow": (l) => [...l.matchAll(/\bbox-shadow\s*:([^;}]*)/g)].some((m) => !/^\s*(?:none|inherit|initial|unset|var\()/.test(m[1]) && /\d/.test(m[1])),
};
const counts = {};
const count = (file, text) => {
  const key = relative(resolve(ROOT, ".."), file);
  const lines = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).split("\n")
    .filter((l) => !/^\s*@media\b/.test(l));
  for (const [rule, test] of Object.entries(STYLE_RULES)) {
    const n = lines.filter((l) => test(l)).length;
    if (n) (counts[key] ??= {})[rule] = n;
  }
};
for (const f of files.filter((f) => f.endsWith(".css") && !f.endsWith("/tokens.css"))) count(f, readFileSync(f, "utf8"));
for (const f of pages) {
  const inline = [...readFileSync(f, "utf8").matchAll(/\sstyle\s*=\s*"([^"]*)"/g)].map((m) => m[1].replace(/;/g, ";\n")).join("\n");
  if (inline) count(f, inline);
}
const baselineFile = resolve(dirname(new URL(import.meta.url).pathname), "style-baseline.json");
if (process.argv.includes("--update-baseline")) {
  writeFileSync(baselineFile, JSON.stringify(counts, null, 2) + "\n");
  console.log("Wrote scripts/style-baseline.json.");
}
const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")) : {};
for (const [file, rules] of Object.entries(counts)) for (const [rule, n] of Object.entries(rules)) {
  const allowed = baseline[file]?.[rule] ?? 0;
  if (n > allowed) errors.push(`${file}: ${n} × ${rule} (allowed ${allowed}); use a --dn-* token`);
}
for (const [file, rules] of Object.entries(baseline)) for (const [rule, allowed] of Object.entries(rules)) {
  if ((counts[file]?.[rule] ?? 0) < allowed) console.log(`! ${file}: ${rule} is down to ${counts[file]?.[rule] ?? 0} (baseline ${allowed}); lower the baseline with --update-baseline`);
}

if (!existsSync(join(ROOT, "CNAME"))) errors.push("site/CNAME is missing");

console.log(`Checked ${pages.length} pages, ${checked} internal links and resources.`);
if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  process.exit(1);
}
console.log("✓ HTML structure, internal links and anchors OK; nothing loaded from another origin.");
