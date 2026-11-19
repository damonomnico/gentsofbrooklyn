<?php
declare(strict_types=1);

/*
 * Review notes for the concept pages.
 *
 * One shared password protects reading and writing. The password is set once on
 * the server and is stored there as a hash; nothing secret lives in this file.
 * Notes are kept in a small JSON store outside the web root where the host allows
 * it. Every stored file starts with a PHP exit line, so it can never be served as
 * readable text even if it ends up inside the web root.
 */

const SETUP_KEY_SHA256 = '92247e907efcc4e75e8aead0e05c66f79adc840a992d088b421f399f98e0acd8';
const MAX_NOTES   = 2000;
const MAX_REPLIES = 100;
const MAX_BODY    = 4000;
const MAX_NAME    = 40;
const MAX_QUOTE   = 600;
const PAGE_RE     = '/^[a-z0-9][a-z0-9-]{0,40}\.html$/';
const SEL_RE      = '/^[A-Za-z0-9 >#:()_\-]{1,800}$/';
const PREFIX      = "<?php exit; ?>\n";
const JSON_FLAGS  = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, private');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function out(array $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_FLAGS);
    exit;
}

function data_dir(): string
{
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    $candidates = [];
    $env = getenv('GOB_NOTES_DIR');
    if (is_string($env) && $env !== '') {
        $candidates[] = $env;
    }
    $candidates[] = dirname(__DIR__, 2) . '/private_html/gob-notes';
    $candidates[] = __DIR__ . '/data';
    foreach ($candidates as $d) {
        if ((@is_dir($d) || @mkdir($d, 0700, true)) && @is_writable($d)) {
            return $dir = $d;
        }
    }
    out(['error' => 'Notes storage is not writable on the server.'], 500);
}

function load(string $name, array $default): array
{
    $f = data_dir() . '/' . $name . '.php';
    if (!is_file($f)) {
        return $default;
    }
    $s = (string) file_get_contents($f);
    if (strncmp($s, PREFIX, strlen(PREFIX)) === 0) {
        $s = substr($s, strlen(PREFIX));
    }
    $j = json_decode($s, true);
    if (!is_array($j)) {
        out(['error' => 'The notes store could not be read.'], 500);
    }
    return $j;
}

function save(string $name, array $data): void
{
    $f = data_dir() . '/' . $name . '.php';
    $tmp = data_dir() . '/' . $name . '.tmp.php';
    if (file_put_contents($tmp, PREFIX . json_encode($data, JSON_FLAGS)) === false || !rename($tmp, $f)) {
        out(['error' => 'Could not save. Please try again.'], 500);
    }
}

function clean($v, int $max, bool $multiline = false): string
{
    if (!is_string($v) || !mb_check_encoding($v, 'UTF-8')) {
        return '';
    }
    $v = str_replace(["\r\n", "\r", "\t"], ["\n", "\n", ' '], $v);
    $v = preg_replace($multiline ? '/[^\P{Cc}\n]/u' : '/\p{Cc}/u', '', $v) ?? '';
    if ($multiline) {
        $v = preg_replace('/\n{3,}/', "\n\n", $v) ?? '';
    }
    return mb_substr(trim($v), 0, $max);
}

function clean_anchor($a): array
{
    if (!is_array($a)) {
        out(['error' => 'That spot could not be saved.'], 400);
    }
    $sel = isset($a['sel']) && is_string($a['sel']) ? $a['sel'] : '';
    if (!preg_match(SEL_RE, $sel)) {
        out(['error' => 'That spot could not be saved.'], 400);
    }
    $frac = static function ($v): float {
        return round(max(0.0, min(1.0, is_numeric($v) ? (float) $v : 0.0)), 4);
    };
    $quote = isset($a['quote']) && is_string($a['quote']) && mb_check_encoding($a['quote'], 'UTF-8') ? $a['quote'] : '';
    if (mb_strlen($quote) > MAX_QUOTE) {
        out(['error' => 'Select a shorter passage.'], 400);
    }
    return [
        'sel'   => $sel,
        'fx'    => $frac($a['fx'] ?? 0),
        'fy'    => $frac($a['fy'] ?? 0),
        'text'  => clean($a['text'] ?? '', 120),
        'quote' => $quote,
        'qs'    => max(0, min(2000000, (int) ($a['qs'] ?? 0))),
    ];
}

function token_for(array $cfg): string
{
    return hash_hmac('sha256', 'gob-notes|' . ($cfg['pv'] ?? 0), (string) ($cfg['secret'] ?? ''));
}

function need_auth(array $cfg, array $in): void
{
    $t = $in['token'] ?? '';
    if (!is_string($t) || empty($cfg['hash']) || !hash_equals(token_for($cfg), $t)) {
        out(['error' => 'Please sign in again.', 'auth' => true], 401);
    }
}

function client_key(): string
{
    $ip = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '');
    $ip = trim(explode(',', $ip)[0]);
    return substr(hash('sha256', $ip), 0, 16);
}

/* Slows down password guessing: 10 misses per visitor in 10 minutes, 300 overall per hour. */
function guard_guessing(bool $failed): void
{
    $now = time();
    $rl = load('rl', ['ip' => [], 'all' => []]);
    $k = client_key();
    $mine = array_values(array_filter($rl['ip'][$k] ?? [], static fn($t) => $t > $now - 600));
    $all = array_values(array_filter($rl['all'] ?? [], static fn($t) => $t > $now - 3600));
    if (!$failed) {
        if (count($mine) >= 10 || count($all) >= 300) {
            out(['error' => 'Too many attempts. Please wait a few minutes and try again.'], 429);
        }
        return;
    }
    $mine[] = $now;
    $all[] = $now;
    $ips = [];
    foreach (($rl['ip'] ?? []) as $key => $times) {
        $times = array_values(array_filter($times, static fn($t) => $t > $now - 600));
        if ($times) {
            $ips[$key] = $times;
        }
    }
    $ips[$k] = $mine;
    save('rl', ['ip' => $ips, 'all' => $all]);
}

function check_password(array $cfg, $pw): bool
{
    return is_string($pw) && $pw !== '' && !empty($cfg['hash']) && password_verify($pw, (string) $cfg['hash']);
}

function new_password($pw): string
{
    if (!is_string($pw) || mb_strlen(trim($pw)) < 8 || strlen($pw) > 200) {
        out(['error' => 'Use a password of at least 8 characters.'], 400);
    }
    return password_hash(trim($pw), PASSWORD_DEFAULT);
}

function &find_note(array &$store, $id)
{
    $null = null;
    if (!is_string($id)) {
        return $null;
    }
    foreach ($store['notes'] as $i => $n) {
        if ($n['id'] === $id) {
            return $store['notes'][$i];
        }
    }
    return $null;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    out(['error' => 'Not available.'], 405);
}
$raw = (string) file_get_contents('php://input', false, null, 0, 200000);
$in = json_decode($raw, true);
if (!is_array($in) || !isset($in['action']) || !is_string($in['action'])) {
    out(['error' => 'Bad request.'], 400);
}

$lock = fopen(data_dir() . '/lock.php', 'c');
if (!$lock || !flock($lock, LOCK_EX)) {
    out(['error' => 'The notes server is busy. Please try again.'], 503);
}

$cfg = load('config', []);
$action = $in['action'];

if ($action === 'setup') {
    $key = $in['key'] ?? '';
    if (!empty($cfg['hash']) || !is_string($key) || !hash_equals(SETUP_KEY_SHA256, hash('sha256', $key))) {
        out(['error' => 'Not available.'], 403);
    }
    $cfg = ['hash' => new_password($in['password'] ?? null), 'secret' => bin2hex(random_bytes(32)), 'pv' => 1];
    save('config', $cfg);
    out(['ok' => true, 'store' => strpos(data_dir(), __DIR__) === 0 ? 'web' : 'private']);
}

if ($action === 'auth') {
    if (empty($cfg['hash'])) {
        out(['error' => 'Notes are not switched on yet.'], 503);
    }
    guard_guessing(false);
    $pw = isset($in['password']) && is_string($in['password']) ? trim($in['password']) : '';
    if (!check_password($cfg, $pw)) {
        guard_guessing(true);
        out(['error' => 'That password is not right.'], 403);
    }
    out(['ok' => true, 'token' => token_for($cfg)]);
}

need_auth($cfg, $in);

if ($action === 'passwd') {
    guard_guessing(false);
    $cur = isset($in['current']) && is_string($in['current']) ? trim($in['current']) : '';
    if (!check_password($cfg, $cur)) {
        guard_guessing(true);
        out(['error' => 'The current password is not right.'], 403);
    }
    $cfg['hash'] = new_password($in['password'] ?? null);
    $cfg['pv'] = (int) $cfg['pv'] + 1;
    save('config', $cfg);
    out(['ok' => true, 'token' => token_for($cfg)]);
}

$store = load('store', ['seq' => 0, 'notes' => []]);
$now = time();
$changed = false;
$extra = [];

switch ($action) {
    case 'list':
        break;

    case 'add':
        $page = $in['page'] ?? '';
        if (!is_string($page) || !preg_match(PAGE_RE, $page)) {
            out(['error' => 'Unknown page.'], 400);
        }
        $author = clean($in['author'] ?? '', MAX_NAME);
        $body = clean($in['body'] ?? '', MAX_BODY, true);
        if ($author === '' || $body === '') {
            out(['error' => 'Add your name and a note first.'], 400);
        }
        if (count($store['notes']) >= MAX_NOTES) {
            out(['error' => 'The notes are full. Clear some resolved notes first.'], 400);
        }
        $store['seq'] = (int) $store['seq'] + 1;
        $id = 'n' . $store['seq'];
        $store['notes'][] = [
            'id' => $id, 'page' => $page, 'author' => $author, 'body' => $body,
            'anchor' => clean_anchor($in['anchor'] ?? null),
            'vw' => max(0, min(10000, (int) ($in['vw'] ?? 0))),
            'ts' => $now, 'resolved' => false, 'replies' => [],
        ];
        $extra['id'] = $id;
        $changed = true;
        break;

    case 'reply':
        $note = &find_note($store, $in['id'] ?? null);
        if ($note === null) {
            out(['error' => 'That note has been removed.'], 404);
        }
        $author = clean($in['author'] ?? '', MAX_NAME);
        $body = clean($in['body'] ?? '', MAX_BODY, true);
        if ($author === '' || $body === '') {
            out(['error' => 'Add your name and a reply first.'], 400);
        }
        if (count($note['replies']) >= MAX_REPLIES) {
            out(['error' => 'This note has too many replies. Start a new note.'], 400);
        }
        $store['seq'] = (int) $store['seq'] + 1;
        $note['replies'][] = ['id' => 'r' . $store['seq'], 'author' => $author, 'body' => $body, 'ts' => $now];
        $changed = true;
        break;

    case 'resolve':
        $note = &find_note($store, $in['id'] ?? null);
        if ($note === null) {
            out(['error' => 'That note has been removed.'], 404);
        }
        $note['resolved'] = !empty($in['resolved']);
        $note['rby'] = clean($in['author'] ?? '', MAX_NAME);
        $note['rts'] = $now;
        $changed = true;
        break;

    case 'delete':
        $id = $in['id'] ?? null;
        $rid = $in['rid'] ?? null;
        if (is_string($rid) && $rid !== '') {
            $note = &find_note($store, $id);
            if ($note !== null) {
                $note['replies'] = array_values(array_filter($note['replies'], static fn($r) => $r['id'] !== $rid));
            }
        } else {
            $store['notes'] = array_values(array_filter($store['notes'], static fn($n) => $n['id'] !== $id));
        }
        $changed = true;
        break;

    default:
        out(['error' => 'Bad request.'], 400);
}

if ($changed) {
    save('store', $store);
}
out(['ok' => true, 'notes' => $store['notes'], 'now' => $now] + $extra);
