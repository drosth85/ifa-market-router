<?php
/**
 * Spotkania umówione w aplikacji IFA (Grip) — kanał ICS per osoba.
 * Zaciągamy wyłącznie CZASY: żadnych tytułów, nazwisk ani opisów. Adresy kanałów są sekretne
 * (kto ma link, widzi cudzy grafik), więc mieszkają w private/config.php i nigdy w repo.
 */

/** Minimalny parser ICS: zwraca [[data, od, do], …] w strefie Berlina, tylko dni targowe. */
function ics_busy(string $body): array {
  $out = [];
  $lines = preg_split('/\r\n|\n|\r/', $body);
  // Rozwijanie linii łamanych (RFC 5545: kontynuacja zaczyna się od spacji lub tabulacji).
  $merged = [];
  foreach ($lines as $l) {
    if ($l !== '' && ($l[0] === ' ' || $l[0] === "\t") && $merged) $merged[count($merged) - 1] .= substr($l, 1);
    else $merged[] = $l;
  }
  $ev = null;
  foreach ($merged as $l) {
    if (strpos($l, 'BEGIN:VEVENT') === 0) { $ev = ['start' => null, 'end' => null, 'allday' => false, 'cancelled' => false]; continue; }
    if ($ev === null) continue;
    if (strpos($l, 'END:VEVENT') === 0) {
      if ($ev['start'] && $ev['end'] && !$ev['allday'] && !$ev['cancelled']) {
        $d = $ev['start']->format('Y-m-d');
        if (in_array($d, fair_days(), true)) $out[] = [$d, $ev['start']->format('H:i'), $ev['end']->format('H:i')];
      }
      $ev = null; continue;
    }
    if (stripos($l, 'STATUS:CANCELLED') === 0) { $ev['cancelled'] = true; continue; }
    if (preg_match('/^(DTSTART|DTEND)([^:]*):(.+)$/i', $l, $m)) {
      $which = strtoupper($m[1]) === 'DTSTART' ? 'start' : 'end';
      $params = $m[2]; $val = trim($m[3]);
      if (stripos($params, 'VALUE=DATE') !== false && strlen($val) === 8) { $ev['allday'] = true; continue; }
      $tz = 'UTC';
      if (preg_match('/TZID=([^;:]+)/i', $params, $t)) $tz = $t[1];
      elseif (substr($val, -1) !== 'Z') $tz = 'Europe/Berlin';        // czas lokalny bez strefy
      try {
        $dt = new DateTimeImmutable($val, new DateTimeZone($tz === 'UTC' ? 'UTC' : $tz));
        $ev[$which] = $dt->setTimezone(new DateTimeZone('Europe/Berlin'));
      } catch (Throwable $e) { $ev[$which] = null; }
    }
  }
  return $out;
}

/** Pobiera kanały wszystkich osób i zapisuje ich zajętość obok danych z Kalendarza Google. */
function ics_refresh(): array {
  $feeds = [];
  try { $feeds = (array)cfg('ics'); } catch (Throwable $e) { return ['ok' => false, 'reason' => 'no-config']; }
  if (!$feeds) return ['ok' => true, 'people' => 0, 'rows' => 0];

  $pdo = db();
  $rows = 0; $people = 0; $failed = [];
  foreach ($feeds as $pid => $url) {
    if (!isset(PEOPLE[$pid]) || !$url) continue;
    $ch = curl_init(str_replace('webcal://', 'https://', (string)$url));
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_FOLLOWLOCATION => true]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !is_string($body) || strpos($body, 'BEGIN:VCALENDAR') === false) { $failed[] = $pid; continue; }
    $spans = ics_busy($body);
    $pdo->beginTransaction();
    try {
      $pdo->prepare("DELETE FROM calendar_busy WHERE person_id = ? AND src = 'ics'")->execute([$pid]);
      $ins = $pdo->prepare("INSERT INTO calendar_busy (person_id,date,from_t,to_t,src) VALUES (?,?,?,?,'ics')");
      foreach ($spans as $sp) { $ins->execute([$pid, $sp[0], $sp[1], $sp[2]]); $rows++; }
      $pdo->commit();
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); $failed[] = $pid; continue; }
    $people++;
  }
  meta_set('last_ics_at', now_berlin()->format('c'));
  return ['ok' => true, 'people' => $people, 'rows' => $rows, 'failed' => $failed];
}
