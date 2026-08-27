<?php
require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_domain.php';

/* Awaryjne odwołanie z listy leadów: kasuje wydarzenie w Kalendarzu i zwalnia kwadrans. */
if (!hash_equals((string)cfg('admin_key'), (string)($_REQUEST['key'] ?? ''))) { http_response_code(403); exit('403'); }

$id = (int)($_REQUEST['id'] ?? 0);
$row = db()->prepare('SELECT * FROM bookings WHERE id = ?');
$row->execute([$id]);
$b = $row->fetch();
if (!$b) json_out(['ok' => false, 'reason' => 'not-found'], 404);

/* Kolejność ma znaczenie: najpierw oznaczamy odwołanie, dopiero potem kasujemy wydarzenie.
   Dzięki temu most, który właśnie tworzy wydarzenie w tle, zobaczy odwołanie i się wycofa. */
db()->prepare('UPDATE bookings SET cancelled_at = ?, cancelled_by = ? WHERE id = ?')
    ->execute([now_berlin()->format('c'), 'admin', $id]);

$calendar = 'skipped';
if (empty($b['calendar_event']) && $b['calendar_state'] === 'pending') {
  sleep(3);                                     // most bywa jeszcze w locie
  $again = db()->prepare('SELECT calendar_event FROM bookings WHERE id = ?');
  $again->execute([$id]);
  $b['calendar_event'] = (string)($again->fetch()['calendar_event'] ?? '');
}
if (!empty($b['calendar_event'])) {
  $payload = ['event' => $b['calendar_event'], 'person' => $b['person_id']];
  $url = cfg('apps_script') . '?action=cancel&payload=' . rawurlencode(json_encode($payload));
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 25]);
  $out = json_decode((string)curl_exec($ch), true);
  curl_close($ch);
  $calendar = !empty($out['ok']) ? 'deleted' : 'failed:' . (string)($out['reason'] ?? 'no-json');
}

db()->prepare("UPDATE bookings SET calendar_state = 'cancelled' WHERE id = ?")->execute([$id]);

if (($_REQUEST['back'] ?? '') === 'list') {
  header('Location: list.php?key=' . urlencode((string)cfg('admin_key')) . '&format=html');
  exit;
}
json_out(['ok' => true, 'id' => $id, 'calendar' => $calendar]);
