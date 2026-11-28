# Download counter on Hostinger

`render-downloads.php` keeps the Get it page's download counter current on a Hostinger
website, with no rebuild or redeploy. It's a PHP port of `scripts/render-downloads.mjs`:
same counting, same markers, same `data/downloads.json`. When you change one, change the other.

GitHub Pages keeps using the Node script in `.github/workflows/pages.yml`.

## Setup (once per website)

1. Upload `render-downloads.php` **outside** the web root, e.g. `/home/USER/scripts/render-downloads.php`.
   It must never sit under `public_html`.
2. Add a cron job for the website (hPanel → Advanced → Cron Jobs, or the Hostinger API's cron
   job operation), once an hour, at a minute other than :00:

   ```
   17 * * * *  php /home/USER/scripts/render-downloads.php /home/USER/domains/DOMAIN/public_html
   ```

3. Optional: if the shared IP runs out of GitHub's 60 unauthenticated calls an hour (the cron
   log shows `GitHub API 403`), put a fine-grained, read-only, public-repos-only token in
   `~/.config/demios/github-token` with `chmod 600`. Never commit it, and never put it under `public_html`.

## Behaviour

- On success, it rewrites the block between `<!-- downloads:start -->` and `<!-- downloads:end -->`
  in `download/index.html` and writes `data/downloads.json`. It writes to a temp file and renames it,
  so visitors never see a half-written page.
- On any GitHub error or unexpected response, it changes nothing, prints the reason to stderr
  and exits 1, so the page keeps its last good numbers.
- A redeploy overwrites the page with the build's numbers. The next cron run updates them again.
- Visitors' browsers still make no request to another origin. Only the server calls GitHub.

## Test locally

```
node scripts/render-downloads.mjs --fixture releases.json          # on a copy of site/
php scripts/hostinger/render-downloads.php COPY_OF_SITE --fixture releases.json
```

Apart from the timestamp and the "Updated …" cadence, both outputs should be identical.
