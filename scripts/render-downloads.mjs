#!/usr/bin/env node
// Renders the Get it page's download counter at build time (Pages workflow, build job).
// Reads GitHub's public release statistics for mimshavandi/demios-desktop: all releases,
// pre-releases included, every page. Sums download_count per OS by file type, writes
// site/data/downloads.json, and fills the block between the downloads markers in
// site/download/index.html. Nothing is committed, and visitors' browsers make no request.
//
//   node scripts/render-downloads.mjs                     live (uses GH_TOKEN if set)
//   node scripts/render-downloads.mjs --fixture file.json  a saved /releases response, for tests
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const REPO = "mimshavandi/demios-desktop";
const PAGE = "site/download/index.html";
const OUT = "site/data/downloads.json";

// Installers only. Checksums, signatures and updater files (SHA256SUMS.txt, *.sig,
// latest.json, *.tar.gz) don't count.
export function osOf(name) {
  if (/\.dmg$/i.test(name)) return "macos";
  if (/\.exe$/i.test(name)) return "windows";
  if (/\.(AppImage|deb|rpm)$/i.test(name)) return "linux";
  return null;
}

async function releases() {
  const fixture = process.argv.indexOf("--fixture");
  if (fixture > 0) return JSON.parse(readFileSync(process.argv[fixture + 1], "utf8"));
  const all = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "demios-landing-build",
        ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status} on page ${page}`);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error("unexpected API response");
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

export function count(list) {
  const byOs = { macos: 0, windows: 0, linux: 0 };
  for (const r of list) {
    if (r.draft) continue;
    for (const a of r.assets ?? []) {
      const os = osOf(String(a.name ?? ""));
      const n = Number(a.download_count);
      if (os && Number.isSafeInteger(n) && n >= 0) byOs[os] += n;
    }
  }
  return { total: byOs.macos + byOs.windows + byOs.linux, by_os: byOs, releases: list.filter((r) => !r.draft).length };
}

const fmt = (n) => n.toLocaleString("en-GB");

export function block(stats, updatedAt) {
  const d = new Date(updatedAt);
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const o = stats.by_os;
  const noun = stats.total === 1 ? "download" : "downloads";
  return `<section class="downloads" aria-labelledby="downloads-title">
      <h2 id="downloads-title" class="downloads-total"><span class="num">${fmt(stats.total)}</span> ${noun}</h2>
      <ul class="downloads-split">
        <li>macOS <span class="num">${fmt(o.macos)}</span></li>
        <li>Windows <span class="num">${fmt(o.windows)}</span></li>
        <li>Linux <span class="num">${fmt(o.linux)}</span></li>
      </ul>
      <p class="downloads-note">All releases, from GitHub's public release statistics. Updated every 6 hours; last on <time datetime="${d.toISOString()}">${day}</time>.</p>
    </section>`;
}

const updatedAt = new Date().toISOString();
const stats = count(await releases());
mkdirSync("site/data", { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated_at: updatedAt, ...stats }, null, 2) + "\n");

const html = readFileSync(PAGE, "utf8");
const re = /(<!-- downloads:start -->)[\s\S]*?(<!-- downloads:end -->)/;
if (!re.test(html)) throw new Error(`${PAGE} has no downloads markers`);
writeFileSync(PAGE, html.replace(re, `$1\n    ${block(stats, updatedAt)}\n    $2`));
console.log(`Downloads: ${stats.total} (macOS ${stats.by_os.macos}, Windows ${stats.by_os.windows}, Linux ${stats.by_os.linux}) across ${stats.releases} releases.`);
