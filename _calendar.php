<?php
/** Most do Kalendarza Google: PHP zapisał lead, Apps Script robi wydarzenie, zaproszenia i maile. */
function push_to_calendar(array $row): array {
  $payload = [
    'name' => $row['name'], 'company' => $row['company'], 'email' => $row['email'],
    'phone' => $row['phone'], 'note' => trim(($row['side'] ? '[' . $row['side'] . '] ' : '') . (string)$row['note']),
    'date' => $row['date'], 'from' => $row['from_t'], 'to' => $row['to_t'],
    'minutes' => (int)$row['minutes'], 'person' => $row['person_id'],
    'evening' => $row['kind'] === 'evening', 'place' => $row['place'],
    'source' => 'php-backend', 'nonce' => 'db-' . $row['id'],
  ];
  $url = cfg('apps_script') . '?action=book&payload=' . rawurlencode(json_encode($payload, JSON_UNESCAPED_UNICODE));
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
                          CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 8]);
  $body = curl_exec($ch);
  $err  = curl_error($ch);
  curl_close($ch);
  if ($err) return ['ok' => false, 'reason' => 'curl:' . $err];
  $out = json_decode((string)$body, true);
  if (!is_array($out)) return ['ok' => false, 'reason' => 'no-json'];
  return $out;
}

/** Odpowiedź gościowi leci od razu; kalendarz dopinamy po jej wysłaniu. */
function finish_response(): void {
  if (function_exists('litespeed_finish_request')) { litespeed_finish_request(); return; }
  if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); return; }
  ignore_user_abort(true);
  @ob_end_flush();
  @flush();
}

function settle_calendar(int $id): void {
  $row = db()->query('SELECT * FROM bookings WHERE id = ' . $id)->fetch();
  if (!$row || $row['calendar_state'] === 'done') return;
  /* Rezerwacja odwołana, zanim most zdążył założyć wydarzenie — nie zakładamy go wcale,
     inaczej w kalendarzu zostaje duch, którego nikt już nie skasuje. */
  if (!empty($row['cancelled_at'])) {
    db()->prepare("UPDATE bookings SET calendar_state = 'cancelled' WHERE id = ?")->execute([$id]);
    return;
  }
  $res = push_to_calendar($row);
  $ok = !empty($res['ok']);
  $attempts = (int)$row['attempts'] + 1;
  $backoff = [60, 300, 900, 3600];
  $next = $ok ? null : now_berlin()
      ->modify('+' . ($backoff[min($attempts - 1, count($backoff) - 1)]) . ' seconds')->format('c');
  db()->prepare('UPDATE bookings SET calendar_state = ?, calendar_event = ?, attempts = ?,
                 next_attempt_at = ?, error = ? WHERE id = ?')
      ->execute([$ok ? 'done' : ($attempts >= 10 ? 'manual' : 'pending'),
                 $res['event'] ?? $row['calendar_event'], $attempts, $next,
                 $ok ? null : (string)($res['reason'] ?? 'unknown'), $id]);
}
