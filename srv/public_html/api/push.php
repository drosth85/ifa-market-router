<?php
require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_domain.php';

$raw = (string)file_get_contents('php://input');
$ts  = $_SERVER['HTTP_X_SYNC_TS'] ?? '';
$sig = $_SERVER['HTTP_X_SYNC_SIG'] ?? '';
$want = hash_hmac('sha256', $ts . '.' . $raw, (string)cfg('sync_key'));
if (!is_numeric($ts) || abs(time() - (int)$ts) > 300 || !hash_equals($want, (string)$sig)) {
  json_out(['ok' => false, 'reason' => 'auth'], 403);
}

$in = json_decode($raw, true);
if (!is_array($in['days'] ?? null)) json_out(['ok' => false, 'reason' => 'bad:payload'], 400);

$pdo = db();
$pdo->beginTransaction();
try {
  // tylko wiersze z Kalendarza Google — zajętość z aplikacji IFA żyje obok, ze źródłem 'ics'
  $del = $pdo->prepare("DELETE FROM calendar_busy WHERE date = ? AND person_id = ? AND src = 'gcal'");
  $seen = $pdo->prepare('INSERT INTO push_seen (person_id,date,seen_at) VALUES (?,?,?)
                         ON CONFLICT(person_id,date) DO UPDATE SET seen_at = excluded.seen_at');
  $ins = $pdo->prepare('INSERT INTO calendar_busy (person_id,date,from_t,to_t) VALUES (?,?,?,?)');
  $rows = 0;
  foreach ($in['days'] as $date => $people) {
    if (!in_array($date, fair_days(), true) || !is_array($people)) continue;
    foreach ($people as $pid => $spans) {
      if (!isset(PEOPLE[$pid]) || !is_array($spans)) continue;
      $del->execute([$date, $pid]);        // podmieniamy WYŁĄCZNIE osoby, które przyszły w paczce
      $seen->execute([$pid, $date, now_berlin()->format('c')]);
      foreach ($spans as $s) {
        if (to_min($s[0] ?? '') < 0 || to_min($s[1] ?? '') < 0) continue;
        $ins->execute([$pid, $date, $s[0], $s[1]]); $rows++;
      }
    }
  }
  meta_set('last_push_at', now_berlin()->format('c'));
  $pdo->commit();
} catch (Throwable $e) {
  if ($pdo->inTransaction()) $pdo->rollBack();
  json_out(['ok' => false, 'reason' => 'server'], 500);
}
json_out(['ok' => true, 'rows' => $rows]);
