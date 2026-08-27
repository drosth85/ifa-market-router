<?php
ini_set('display_errors','1'); error_reporting(E_ALL);
require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_domain.php';
require_once __DIR__ . '/free.php';
header('Content-Type: text/plain; charset=utf-8');
if (!hash_equals((string)cfg('admin_key'), (string)($_GET['key'] ?? ''))) { http_response_code(403); exit('403'); }

$pass = 0; $fail = 0;
function ok($cond, string $label): void {
  global $pass, $fail;
  try { $v = is_callable($cond) ? $cond() : $cond; }
  catch (Throwable $e) { $fail++; echo "  THROW: $label -> {$e->getMessage()}\n"; return; }
  if ($v) { $pass++; } else { $fail++; echo "  FAIL: $label\n"; }
}

$good = ['name'=>'Jan Kowalski','company'=>'Acme','email'=>'jan@acme.com','date'=>'2026-09-05',
         'from'=>'11:00','to'=>'11:15','person'=>'tabak','evening'=>false,'consent'=>1];

ok(validate_booking($good) === [], 'poprawna rezerwacja przechodzi');
ok(in_array('email', validate_booking(array_merge($good,['email'=>'nie-mail']))), 'zly e-mail odrzucony');
ok(in_array('date', validate_booking(array_merge($good,['date'=>'2026-09-09']))), 'dzien spoza targow odrzucony');
ok(in_array('grid', validate_booking(array_merge($good,['from'=>'11:05','to'=>'11:20']))), 'start poza siatka odrzucony');
ok(in_array('duration', validate_booking(array_merge($good,['to'=>'12:00']))), '60 minut poza lista dlugosci');
ok(in_array('hours', validate_booking(array_merge($good,['from'=>'17:45','to'=>'18:15']))), 'spotkanie po zamknieciu odrzucone');
ok(in_array('person', validate_booking(array_merge($good,['person'=>'obcy']))), 'osoba spoza listy odrzucona');
ok(in_array('consent', validate_booking(array_merge($good,['consent'=>0]))), 'brak zgody RODO odrzucony');
ok(validate_booking(array_merge($good,['person'=>'any'])) === [], 'anyone free jest poprawnym wyborem');
ok(in_array('place', validate_booking(array_merge($good,['evening'=>true,'from'=>'19:00','to'=>'20:00']))), 'wieczor bez miejsca odrzucony');
ok(validate_booking(array_merge($good,['evening'=>true,'from'=>'19:00','to'=>'20:00','place'=>'Hotel bar'])) === [], 'wieczor z miejscem przechodzi');
ok(fn() => is_array(validate_booking(array_merge($good,['to'=>null]))), 'brak godziny koncowej nie wywala walidatora');

ok(overlaps('10:00','10:45','10:30','10:45'), 'nachodzenie wykryte');
ok(!overlaps('10:00','10:15','10:15','10:30'), 'styk koniec-poczatek to nie kolizja');
ok(clean_field("Jan\r\nKowalski", 80) === 'Jan Kowalski', 'nowe linie wyciete');
ok(mb_strlen(clean_field(str_repeat('x', 500), 80)) === 80, 'pole przyciete do limitu');
ok(defuse_formula('=HYPERLINK("x")')[0] === "'", 'formula w CSV rozbrojona');

// zajetosc i liczby wolnych kwadransow
db()->exec("DELETE FROM bookings WHERE source='test'");
db()->exec("DELETE FROM calendar_busy WHERE person_id='tabak' AND date='2026-09-04'");
db()->prepare('INSERT INTO bookings (created_at,date,from_t,to_t,minutes,kind,person_id,name,company,email,source,consent)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,1)')
    ->execute([date('c'),'2026-09-04','12:00','12:30',30,'stand','tabak','T','T','t@t.pl','test']);
db()->prepare('INSERT INTO calendar_busy (person_id,date,from_t,to_t) VALUES (?,?,?,?)')
    ->execute(['tabak','2026-09-04','15:00','15:45']);
$b = busy_for_day('2026-09-04');
ok(count($b['tabak']) === 2, 'zajetosc laczy rezerwacje i kalendarz');
ok($b['drozd'] === [], 'osoba bez spotkan ma pusta zajetosc');
ok(free_quarters($b['tabak']) === 32 - 5, 'wolne kwadranse policzone (32 minus 2 i 3)');
ok(free_quarters([]) === 32, 'pusty dzien to 32 kwadranse');
db()->exec("DELETE FROM bookings WHERE source='test'");
db()->exec("DELETE FROM calendar_busy WHERE person_id='tabak' AND date='2026-09-04'");

echo "\n$pass passed, $fail failed\n";
