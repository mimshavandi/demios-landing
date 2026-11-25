#!/usr/bin/env node
// Copies the app's design tokens and two app screenshots from a demios-desktop checkout into
// site/assets/, and records the source commit and a SHA-256 of each file in
// scripts/design-source.json. check-site fails if a copied file no longer matches that record,
// so the site's tokens are never hand-edited.
//
//   node scripts/sync-design.mjs ../demios-desktop     (a clean checkout of main)
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const src = resolve(process.argv[2] ?? "../demios-desktop");
const git = (...a) => execFileSync("git", ["-C", src, ...a], { encoding: "utf8" }).trim();
if (git("status", "--porcelain", "--", "ui/design-tokens", "apps/desktop/docs/screenshots")) {
  console.error(`✗ ${src} has local changes in the copied paths; use a clean checkout.`);
  process.exit(1);
}

// From → to (relative to the demios-desktop checkout and to this repo).
export const FILES = {
  "ui/design-tokens/tokens.css": "site/assets/tokens.css",
  "apps/desktop/docs/screenshots/light-artifact-pane.jpg": "site/assets/app-light.jpg",
  "apps/desktop/docs/screenshots/dark-artifact-pane.jpg": "site/assets/app-dark.jpg",
};

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const record = { repo: "mimshavandi/demios-desktop", commit: git("rev-parse", "HEAD"), files: {} };
for (const [from, to] of Object.entries(FILES)) {
  copyFileSync(join(src, from), to);
  record.files[to] = { from, sha256: sha(to) };
}
writeFileSync("scripts/design-source.json", JSON.stringify(record, null, 2) + "\n");
console.log(`Copied ${Object.keys(FILES).length} files from ${record.repo}@${record.commit.slice(0, 7)}.`);
