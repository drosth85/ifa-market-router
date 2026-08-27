<?php
/* Reguły domenowe — jedyne miejsce, w którym żyją ludzie, godziny i walidacja. */

const PEOPLE = [
  'any'        => ['name' => 'Anyone free',        'email' => '', 'role' => 'We assign the first colleague free', 'langs' => ''],
  'juszczyk'   => ['name' => 'Sebastian Juszczyk', 'email' => 'sebastian@monstelo.com',            'role' => 'Board member · sourcing', 'langs' => 'EN,PL'],
  'mamcarczyk' => ['name' => 'Michał Mamcarczyk',  'email' => 'mm@monstelo.com',                   'role' => 'Key Account Manager',     'langs' => 'EN,PL'],
  'tuchowska'  => ['name' => 'Nikola Tuchowska',   'email' => 'nikola.tuchowska@monstelo.com',     'role' => 'Key Account Manager',     'langs' => 'EN,PL'],
  'tabak'      => ['name' => 'Łukasz Tabak',       'email' => 'lukasz.tabak@monstelo.com',         'role' => 'Key Account Manager',     'langs' => 'PL'],
  'kocaba'     => ['name' => 'Błażej Kócaba',      'email' => 'blazej.kocaba@monstelo.com',        'role' => 'Key Account Manager',     'langs' => 'PL'],
  'drozd'      => ['name' => 'Tomasz Drozd',       'email' => 'tomasz.drozd@monstelo.com',         'role' => 'Brand growth · retail',   'langs' => 'EN,PL'],
  'palka'      => ['name' => 'Kamil Pałka',        'email' => 'kamil.palka@monstelo.com',          'role' => 'Key Account Manager',     'langs' => 'PL,CZ'],
];
const ASSIGN_ORDER = ['juszczyk','mamcarczyk','tuchowska','tabak','kocaba','drozd','palka'];
const DAY_START_H = 10, DAY_END_H = 18, EVENING_END_H = 23, DURATIONS = [15, 30, 45];
/* Limity. UWAGA na targach: cała hala wychodzi do sieci przez jeden NAT (wifi Messe Berlin,
   hotspoty operatorów), więc limit per IP musi być luźny — inaczej odetnie zwykłych gości.
   Realną obroną są limity per adres e-mail i dobowy oraz wyłącznik `booking_enabled`. */
const MAX_PER_DAY = 150, MAX_PER_MAIL = 5, MAX_PER_IP_HOUR = 40;

function to_min($hhmm): int {
  if (!is_string($hhmm) || !preg_match('/^\d{2}:\d{2}$/', $hhmm)) return -1;
  [$h, $m] = array_map('intval', explode(':', $hhmm));
  return $h * 60 + $m;
}

function hhmm(int $min): string { return sprintf('%02d:%02d', intdiv($min, 60), $min % 60); }

function overlaps(string $aF, string $aT, string $bF, string $bT): bool {
  return to_min($aF) < to_min($bT) && to_min($bF) < to_min($aT);
}

/** Bez znaków sterujących (żadnych zabaw z nagłówkami maila) i z twardym limitem długości. */
function clean_field($v, int $max): string {
  $s = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$v);
  return mb_substr(trim((string)preg_replace('/\s+/u', ' ', (string)$s)), 0, $max);
}

/** Arkusze i CSV traktują wiodące =,+,-,@ jako formułę — neutralizujemy przy zapisie. */
function defuse_formula(string $v): string {
  return ($v !== '' && strpos("=+-@", $v[0]) !== false) ? "'" . $v : $v;
}

/** @return string[] kody błędów; pusta lista = rezerwacja poprawna */
function validate_booking(array $b): array {
  $err = [];
  if (mb_strlen(clean_field($b['name'] ?? '', 200)) < 3) $err[] = 'name';
  if (mb_strlen(clean_field($b['company'] ?? '', 200)) < 1) $err[] = 'company';
  if (!filter_var($b['email'] ?? '', FILTER_VALIDATE_EMAIL)) $err[] = 'email';
  if (!in_array($b['date'] ?? '', fair_days(), true)) $err[] = 'date';
  $from = to_min($b['from'] ?? null); $to = to_min($b['to'] ?? null);
  if ($from < 0 || $to < 0 || $to <= $from) $err[] = 'slot';
  if (!isset(PEOPLE[$b['person'] ?? ''])) $err[] = 'person';
  if (empty($b['consent'])) $err[] = 'consent';
  if (!empty($b['evening'])) {
    if (clean_field($b['place'] ?? '', 120) === '') $err[] = 'place';
    if ($from >= 0 && $to >= 0 && ($from < DAY_END_H * 60 || $to > EVENING_END_H * 60 || $to - $from > 180)) $err[] = 'evening';
  } elseif ($from >= 0 && $to >= 0) {
    if ($from % 15 !== 0) $err[] = 'grid';
    if (!in_array($to - $from, DURATIONS, true)) $err[] = 'duration';
    if ($from < DAY_START_H * 60 || $to > DAY_END_H * 60) $err[] = 'hours';
  }
  return array_values(array_unique($err));
}
