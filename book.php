<?php
require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_domain.php';
require_once __DIR__ . '/free.php';
require_once __DIR__ . '/_calendar.php';
cors();

function is_taken(string $date, string $from, string $to, string $pid): bool {
  foreach (busy_for_day($date)[$pid] ?? [] as $w) if (overlaps($from, $to, $w[0], $w[1])) return true;
  return false;
}

/** Pierwsza wolna osoba wg kolejności — „Anyone free" ma dostać kogoś konkretnego. */
function first_free(string $date, string $from, string $to): ?string {
  foreach (ASSIGN_ORDER as $pid) if (!is_taken($date, $from, $to, $pid)) return $pid;
  return null;
}

function ip_hash(): string {
  return substr(hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . cfg('sync_key')), 0, 32);
}

/**
 * Limity liczone od PRÓB dla IP (tania obrona) i od SUKCESÓW dla adresu i doby.
 * Nagłówek X-Admin-Key zdejmuje limity — wyłącznie dla testów prowadzonych z kluczem
 * administratora; walidacja, kolizje i idempotencja obowiązują tak samo.
 */
function under_limits(string $email): array {
  $adminHeader = $_SERVER['HTTP_X_ADMIN_KEY'] ?? '';
  if ($adminHeader !== '' && hash_equals((string)cfg('admin_key'), (string)$adminHeader)) {
    return ['ok' => true, 'bypass' => true];
  }
  $today = now_berlin()->format('Y-m-d');
  $c = db()->prepare("SELECT COUNT(*) c FROM bookings WHERE substr(created_at,1,10) = ?");
  $c->execute([$today]);
  if ((int)$c->fetch()['c'] >= MAX_PER_DAY) return ['ok' => false, 'reason' => 'limit:day'];
  $c = db()->prepare("SELECT COUNT(*) c FROM bookings WHERE substr(created_at,1,10) = ? AND lower(email) = ?");
  $c->execute([$today, mb_strtolower($email)]);
  if ((int)$c->fetch()['c'] >= MAX_PER_MAIL) return ['ok' => false, 'reason' => 'limit:email'];
  $c = db()->prepare("SELECT COUNT(*) c FROM bookings WHERE ip_hash = ? AND created_at > ?");
  $c->execute([ip_hash(), now_berlin()->modify('-1 hour')->format('c')]);
  if ((int)$c->fetch()['c'] >= MAX_PER_IP_HOUR) return ['ok' => false, 'reason' => 'limit:ip'];
  return ['ok' => true];
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') json_out(['ok' => false, 'reason' => 'bad:method'], 405);
if (meta_get('booking_enabled', 'yes') === 'no') json_out(['ok' => false, 'reason' => 'closed'], 503);

$b = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($b)) json_out(['ok' => false, 'reason' => 'bad:payload'], 400);

$err = validate_booking($b);
if ($err) json_out(['ok' => false, 'reason' => 'bad:' . implode(',', $err)], 400);

$email = clean_field($b['email'], 120);
$lim = under_limits($email);
if (!$lim['ok']) json_out(['ok' => false, 'reason' => $lim['reason']], 429);

$pdo = db();
$pdo->beginTransaction();
try {
  $nonce = clean_field($b['nonce'] ?? '', 64);
  if ($nonce !== '') {
    $prev = $pdo->prepare('SELECT id, person_name FROM bookings WHERE nonce = ?');
    $prev->execute([$nonce]);
    if ($row = $prev->fetch()) {                      // to samo zgłoszenie drugi raz
      $pdo->commit();
      json_out(['ok' => true, 'booked' => true, 'id' => (int)$row['id'],
                'person' => $row['person_name'], 'repeat' => true]);
    }
  }
  $pid = $b['person']; $assigned = false;
  if (empty($b['evening'])) {
    if ($pid === 'any') {
      $pid = first_free($b['date'], $b['from'], $b['to']);
      if ($pid === null) { $pdo->rollBack(); json_out(['ok' => false, 'reason' => 'taken']); }
      $assigned = true;
    } elseif (is_taken($b['date'], $b['from'], $b['to'], $pid)) {
      $pdo->rollBack();
      json_out(['ok' => false, 'reason' => 'taken']);
    }
  }
  $stmt = $pdo->prepare('INSERT INTO bookings
    (created_at,date,from_t,to_t,minutes,kind,place,person_id,person_name,person_email,
     name,company,email,phone,note,side,consent,marketing,source,nonce,ua,ip_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  $stmt->execute([
    now_berlin()->format('c'), $b['date'], $b['from'], $b['to'],
    to_min($b['to']) - to_min($b['from']), empty($b['evening']) ? 'stand' : 'evening',
    clean_field($b['place'] ?? '', 120), $pid, PEOPLE[$pid]['name'], PEOPLE[$pid]['email'],
    defuse_formula(clean_field($b['name'], 80)), defuse_formula(clean_field($b['company'], 80)),
    $email, clean_field($b['phone'] ?? '', 30), defuse_formula(clean_field($b['note'] ?? '', 500)),
    clean_field($b['side'] ?? '', 10), 1, !empty($b['marketing']) ? 1 : 0,
    clean_field($b['source'] ?? '', 40), $nonce,
    clean_field($_SERVER['HTTP_USER_AGENT'] ?? '', 180), ip_hash(),
  ]);
  $id = (int)$pdo->lastInsertId();
  $pdo->commit();
} catch (Throwable $e) {
  if ($pdo->inTransaction()) $pdo->rollBack();
  json_out(['ok' => false, 'reason' => 'server'], 500);
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode(['ok' => true, 'booked' => true, 'id' => $id,
                  'person' => PEOPLE[$pid]['name'], 'assigned' => $assigned], JSON_UNESCAPED_UNICODE);
finish_response();
settle_calendar($id);      // gość już ma odpowiedź; kalendarz dopinamy po cichu
