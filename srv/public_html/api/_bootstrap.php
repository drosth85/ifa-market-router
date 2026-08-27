<?php
declare(strict_types=1);
date_default_timezone_set('Europe/Berlin');   // serwer stoi na Europe/Warsaw

function cfg(string $k) {
  static $c = null;
  if ($c === null) { $c = require __DIR__ . '/../private/config.php'; }
  if (!array_key_exists($k, $c)) { throw new RuntimeException("missing config: $k"); }
  return $c[$k];
}

function cors(): void {
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  if ($origin !== '' && in_array($origin, cfg('origins'), true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  }
  header('X-Content-Type-Options: nosniff');
  if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
}

function db(): PDO {
  static $pdo = null;
  if ($pdo !== null) return $pdo;
  $pdo = new PDO('sqlite:' . cfg('db'), null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
  $pdo->exec('PRAGMA journal_mode=WAL');
  $pdo->exec('PRAGMA busy_timeout=5000');
  $pdo->exec('CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, date TEXT NOT NULL,
    from_t TEXT NOT NULL, to_t TEXT NOT NULL, minutes INTEGER NOT NULL, kind TEXT NOT NULL,
    place TEXT, person_id TEXT NOT NULL, person_name TEXT, person_email TEXT,
    name TEXT NOT NULL, company TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, note TEXT,
    side TEXT, consent INTEGER DEFAULT 0, marketing INTEGER DEFAULT 0,
    source TEXT, nonce TEXT UNIQUE, ua TEXT, ip_hash TEXT,
    calendar_state TEXT DEFAULT "pending", calendar_event TEXT, attempts INTEGER DEFAULT 0,
    next_attempt_at TEXT, error TEXT, cancelled_at TEXT, cancelled_by TEXT)');
  foreach (['cancelled_at','cancelled_by'] as $col) {          // migracja istniejącej bazy
    try { $pdo->exec("ALTER TABLE bookings ADD COLUMN $col TEXT"); } catch (Throwable $e) {}
  }
  /* Ślad po każdym udanym odczycie kalendarza: bez niego nie da się odróżnić
     "handlowiec skasował spotkanie" od "nie udało się odczytać kalendarza". */
  $pdo->exec('CREATE TABLE IF NOT EXISTS push_seen (
    person_id TEXT NOT NULL, date TEXT NOT NULL, seen_at TEXT NOT NULL,
    PRIMARY KEY (person_id, date))');
  $pdo->exec('CREATE INDEX IF NOT EXISTS idx_bookings_day ON bookings(date, kind)');
  $pdo->exec("CREATE TABLE IF NOT EXISTS calendar_busy (
    person_id TEXT NOT NULL, date TEXT NOT NULL, from_t TEXT NOT NULL, to_t TEXT NOT NULL,
    src TEXT NOT NULL DEFAULT 'gcal')");
  try { $pdo->exec("ALTER TABLE calendar_busy ADD COLUMN src TEXT NOT NULL DEFAULT 'gcal'"); } catch (Throwable $e) {}
  $pdo->exec('CREATE INDEX IF NOT EXISTS idx_busy_day ON calendar_busy(date)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT)');
  return $pdo;
}

function meta_get(string $k, ?string $default = null): ?string {
  $q = db()->prepare('SELECT value FROM sync_meta WHERE key = ?');
  $q->execute([$k]);
  $r = $q->fetch();
  return $r ? (string)$r['value'] : $default;
}

function meta_set(string $k, string $v): void {
  db()->prepare('INSERT INTO sync_meta (key,value) VALUES (?,?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value')->execute([$k, $v]);
}

function json_out(array $data, int $code = 200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function fair_days(): array {
  return ['2026-09-04','2026-09-05','2026-09-06','2026-09-07','2026-09-08'];
}

function now_berlin(): DateTimeImmutable { return new DateTimeImmutable('now'); }
