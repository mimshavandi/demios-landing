<?php
// Refreshes the Get it page's download counter on the server (Hostinger cron), so the
// counter stays current without a rebuild and redeploy. Same counting and markup as
// scripts/render-downloads.mjs, which still runs at build time; keep the two in step.
//
// It reads GitHub's public release statistics for the desktop repo, server side. Visitors'
// browsers still make no request to another origin. It rewrites, in place, the block
// between the downloads markers in download/index.html and data/downloads.json under the
// web root. If GitHub fails or answers oddly, it changes nothing and exits non-zero, and the
// page keeps the last good numbers.
//
//   php render-downloads.php /home/USER/domains/DOMAIN/public_html
//   php render-downloads.php WEBROOT --fixture releases.json     a saved /releases response, for tests
//
// Keep this file outside public_html, so it is never served. GitHub allows 60 unauthenticated
// calls an hour per IP, and a shared host's IP may use them up. A read-only token in
// ~/.config/demios/github-token (chmod 600, outside the web root) is then used if present.
// Never commit a token.

declare(strict_types=1);

const REPO = 'mimshavandi/demios-desktop';
const PAGE = 'download/index.html';
const OUT = 'data/downloads.json';
const CADENCE = 'every hour'; // matches the cron schedule

function fail(string $msg): never
{
    fwrite(STDERR, "render-downloads: $msg\n");
    exit(1);
}

// Installers only. Checksums, signatures and updater files (SHA256SUMS.txt, *.sig,
// latest.json, *.tar.gz) don't count.
function os_of(string $name): ?string
{
    if (preg_match('/\.dmg$/i', $name)) return 'macos';
    if (preg_match('/\.exe$/i', $name)) return 'windows';
    if (preg_match('/\.(AppImage|deb|rpm)$/i', $name)) return 'linux';
    return null;
}

function token(): ?string
{
    $home = getenv('HOME') ?: '';
    $file = "$home/.config/demios/github-token";
    if ($home === '' || !is_readable($file)) return null;
    $t = trim((string) file_get_contents($file));
    return $t === '' ? null : $t;
}

function releases(?string $fixture): array
{
    if ($fixture !== null) {
        $data = json_decode((string) file_get_contents($fixture), true);
        if (!is_array($data)) fail('fixture is not a JSON array');
        return $data;
    }
    $headers = [
        'Accept: application/vnd.github+json',
        'X-GitHub-Api-Version: 2022-11-28',
        'User-Agent: demios-landing-cron',
    ];
    $t = token();
    if ($t !== null) $headers[] = "Authorization: Bearer $t";
    $all = [];
    for ($page = 1; $page <= 50; $page++) {
        $ch = curl_init('https://api.github.com/repos/' . REPO . "/releases?per_page=100&page=$page");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($body === false || $status !== 200) fail("GitHub API $status on page $page");
        $batch = json_decode((string) $body, true);
        if (!is_array($batch) || !array_is_list($batch)) fail('unexpected API response');
        array_push($all, ...$batch);
        if (count($batch) < 100) return $all;
    }
    fail('too many release pages');
}

// A non-negative whole number, read the way the Node script's Number() and
// Number.isSafeInteger() read it (7, 7.0 and "7" count; -3, 1.5 and "x" don't).
function whole(mixed $v): ?int
{
    if ($v === null) return 0; // Number(undefined) is NaN, but adding 0 changes nothing either
    if (is_string($v)) {
        $s = trim($v);
        if ($s === '') return 0; // Number("") is 0
        if (!is_numeric($s)) return null;
        $v = $s + 0;
    }
    if (is_float($v) && is_finite($v) && floor($v) === $v && abs($v) <= 9007199254740991) $v = (int) $v;
    return is_int($v) && $v >= 0 && $v <= 9007199254740991 ? $v : null;
}

function tally(array $list): array
{
    $by = ['macos' => 0, 'windows' => 0, 'linux' => 0];
    $releases = 0;
    foreach ($list as $r) {
        if (!is_array($r) || !empty($r['draft'])) continue;
        $releases++;
        foreach (($r['assets'] ?? []) as $a) {
            if (!is_array($a)) continue;
            $os = os_of((string) ($a['name'] ?? ''));
            $n = whole($a['download_count'] ?? null);
            if ($os !== null && $n !== null) $by[$os] += $n;
        }
    }
    return ['total' => $by['macos'] + $by['windows'] + $by['linux'], 'by_os' => $by, 'releases' => $releases];
}

function fmt(int $n): string
{
    return number_format($n); // 1,234, as en-GB
}

function block(array $s, DateTimeImmutable $at): string
{
    $iso = $at->format('Y-m-d\TH:i:s.v\Z');
    $day = $at->format('j F Y');
    $o = $s['by_os'];
    $noun = $s['total'] === 1 ? 'download' : 'downloads';
    $cadence = CADENCE;
    [$total, $mac, $win, $lin] = [fmt($s['total']), fmt($o['macos']), fmt($o['windows']), fmt($o['linux'])];
    return <<<HTML
<section class="downloads" aria-labelledby="downloads-title">
      <h2 id="downloads-title" class="downloads-total"><span class="num">$total</span> $noun</h2>
      <ul class="downloads-split">
        <li>macOS <span class="num">$mac</span></li>
        <li>Windows <span class="num">$win</span></li>
        <li>Linux <span class="num">$lin</span></li>
      </ul>
      <p class="downloads-note">All releases, from GitHub's public release statistics. Updated $cadence; last on <time datetime="$iso">$day</time>.</p>
    </section>
HTML;
}

// Write next to the target, then rename, so a visitor never gets a half-written file.
function write_atomic(string $path, string $data): void
{
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0755, true)) fail("cannot create $dir");
    $tmp = "$path.tmp-" . getmypid();
    if (file_put_contents($tmp, $data) === false) fail("cannot write $tmp");
    chmod($tmp, 0644);
    if (!rename($tmp, $path)) { @unlink($tmp); fail("cannot replace $path"); }
}

$args = array_slice($argv, 1);
$root = $args[0] ?? null;
if ($root === null || !is_dir($root)) fail('usage: php render-downloads.php WEBROOT [--fixture file.json]');
$root = rtrim($root, '/');
$fi = array_search('--fixture', $args, true);
$fixture = $fi !== false ? ($args[$fi + 1] ?? fail('--fixture needs a file')) : null;

$at = new DateTimeImmutable('now', new DateTimeZone('UTC'));
$stats = tally(releases($fixture));

$page = "$root/" . PAGE;
$html = @file_get_contents($page);
if ($html === false) fail("cannot read $page");
$re = '/(<!-- downloads:start -->)[\s\S]*?(<!-- downloads:end -->)/';
if (!preg_match($re, $html)) fail(PAGE . ' has no downloads markers');
$new = preg_replace_callback($re, fn($m) => $m[1] . "\n    " . block($stats, $at) . "\n    " . $m[2], $html, 1);

$json = json_encode(['updated_at' => $at->format('Y-m-d\TH:i:s.v\Z')] + $stats, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
// Two-space indent, like JSON.stringify(…, null, 2) in the Node script.
$json = preg_replace_callback('/^ +/m', fn($m) => str_repeat(' ', intdiv(strlen($m[0]), 2)), $json);
write_atomic("$root/" . OUT, $json . "\n");
write_atomic($page, $new);
printf("Downloads: %d (macOS %d, Windows %d, Linux %d) across %d releases.\n",
    $stats['total'], $stats['by_os']['macos'], $stats['by_os']['windows'], $stats['by_os']['linux'], $stats['releases']);
