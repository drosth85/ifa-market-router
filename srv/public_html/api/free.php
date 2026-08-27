<?php
require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_domain.php';
require_once __DIR__ . '/_ics.php';
require_once __DIR__ . '/_calendar.php';

/** Zajętość dnia: nasze rezerwacje + ostatnia migawka z Kalendarza Google. */
function busy_for_day(string $date): array {
  $out = [];
  foreach (ASSIGN_ORDER as $pid) $out[$pid] = [];
  $q = db()->prepare("SELECT person_id, from_t, to_t FROM bookings
                      WHERE date = ? AND kind = 'stand' AND cancelled_at IS NULL");
  $q->execute([$date]);
  foreach ($q as $r) if (isset($out[$r['person_id']])) $out[$r['person_id']][] = [$r['from_t'], $r['to_t']];
  $q = db()->prepare('SELECT person_id, from_t, to_t FROM calendar_busy WHERE date = ?');
  $q->execute([$date]);
  foreach ($q as $r) if (isset($out[$r['person_id']])) $out[$r['person_id']][] = [$r['from_t'], $r['to_t']];
  return $out;
}

/** Ile kwadransów danego dnia jest jeszcze wolnych — do liczb przy nazwiskach. */
function free_quarters(array $busy): int {
  $n = 0;
  for ($m = DAY_START_H * 60; $m < DAY_END_H * 60; $m += 15) {
    $free = true;
    foreach ($busy as $w) { if (to_min($w[0]) < $m + 15 && $m < to_min($w[1])) { $free = false; break; } }
    if ($free) $n++;
  }
  return $n;
}

if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === 'free.php') {
  cors();
  $date = (string)($_GET['date'] ?? '');
  if (!in_array($date, fair_days(), true)) json_out(['ok' => false, 'reason' => 'bad:date'], 400);
  reconcile_cancellations($date);      // skasowane w kalendarzu = zwolniony kwadrans
  $people = busy_for_day($date);
  $free = [];
  foreach ($people as $pid => $spans) $free[$pid] = free_quarters($spans);
  $pushed = meta_get('last_push_at');
  header('Cache-Control: private, max-age=20');
  $icsAt = meta_get('last_ics_at');
  $icsStale = !$icsAt || (time() - strtotime($icsAt)) > 300;
  echo json_encode([
    'ok' => true, 'date' => $date, 'people' => $people, 'free' => $free,
    'generated_at' => $pushed,
    'stale_seconds' => $pushed ? max(0, time() - strtotime($pushed)) : null,
    'booking_enabled' => meta_get('booking_enabled', 'yes') !== 'no',
    'ics_at' => $icsAt,
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

  /* Kanały ICS z aplikacji IFA odświeżamy PO odesłaniu odpowiedzi — gość nigdy na to nie czeka. */
  if ($icsStale) { finish_response(); ics_refresh(); }
  exit;
}

/**
 * Handlowiec kasuje spotkanie tak, jak mu wygodnie: usuwa wydarzenie ze swojego kalendarza.
 * Tutaj to wyłapujemy — rezerwacja, której wydarzenia nie ma już w świeżej migawce, zostaje
 * oznaczona jako odwołana i przestaje blokować kwadrans. Lead zostaje na liście.
 *
 * Trzy bezpieczniki, żeby NIE odwołać czegoś przez awarię odczytu:
 *   1. migawka tej osoby i tego dnia musi istnieć i być świeższa niż 15 minut,
 *   2. migawka musi być NOWSZA niż sama rezerwacja (inaczej odwołalibyśmy świeżo złożoną),
 *   3. rezerwacja musi mieć potwierdzone wydarzenie w kalendarzu (`calendar_state = done`).
 */
function reconcile_cancellations(string $date): int {
    $seen = [];
    $q = db()->prepare('SELECT person_id, seen_at FROM push_seen WHERE date = ?');
    $q->execute([$date]);
    foreach ($q as $r) $seen[$r['person_id']] = $r['seen_at'];
    if (!$seen) return 0;

    $spans = [];
    $q = db()->prepare('SELECT person_id, from_t, to_t FROM calendar_busy WHERE date = ?');
    $q->execute([$date]);
    foreach ($q as $r) $spans[$r['person_id']][] = [$r['from_t'], $r['to_t']];

    $rows = db()->prepare("SELECT id, person_id, from_t, to_t, created_at FROM bookings
                           WHERE date = ? AND kind = 'stand' AND cancelled_at IS NULL
                             AND calendar_state = 'done'");
    $rows->execute([$date]);
    $limit = now_berlin()->modify('-15 minutes')->format('c');
    $n = 0;
    foreach ($rows as $b) {
        $pid = $b['person_id'];
        if (!isset($seen[$pid]) || $seen[$pid] < $limit) continue;      // brak świeżej migawki
        if ($seen[$pid] <= $b['created_at']) continue;                  // migawka starsza niż rezerwacja
        $found = false;
        foreach ($spans[$pid] ?? [] as $w) {
            if (overlaps($b['from_t'], $b['to_t'], $w[0], $w[1])) { $found = true; break; }
        }
        if ($found) continue;
        db()->prepare('UPDATE bookings SET cancelled_at = ?, cancelled_by = ? WHERE id = ?')
            ->execute([now_berlin()->format('c'), 'calendar', $b['id']]);
        $n++;
    }
    return $n;
}
