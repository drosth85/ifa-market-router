<?php
require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_domain.php';
if (!hash_equals((string)cfg('admin_key'), (string)($_GET['key'] ?? ''))) { http_response_code(403); exit('403'); }
$rows = db()->query('SELECT * FROM bookings ORDER BY date, from_t')->fetchAll();
$key = urlencode((string)cfg('admin_key'));

if (($_GET['format'] ?? '') === 'html') {
  header('Content-Type: text/html; charset=utf-8');
  $h = fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
  echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
  echo '<title>IFA — rezerwacje</title><style>
    body{background:#0A0B0E;color:#E9E0CC;font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial;margin:0;padding:18px}
    h1{font-size:20px;margin:0 0 4px} .sub{color:#7C8593;font-size:12px;margin-bottom:16px}
    table{border-collapse:collapse;width:100%;font-size:13px} th,td{padding:9px 8px;border-bottom:1px solid #232833;text-align:left;vertical-align:top}
    th{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#7C8593;font-weight:600}
    tr.off td{opacity:.45;text-decoration:line-through}
    .btn{display:inline-block;padding:6px 10px;border:1px solid #FF6B5A;color:#FF6B5A;border-radius:6px;
      text-decoration:none;font-size:11px} .btn:hover{background:#FF6B5A;color:#0A0B0E}
    .tag{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#7C8593}
    a.csv{color:#2FE3C6;font-size:12px}
  </style>';
  $live = count(array_filter($rows, fn($r) => empty($r['cancelled_at'])));
  echo '<h1>Rezerwacje IFA 2026</h1><div class="sub">' . $live . ' aktywnych z ' . count($rows) .
       ' · <a class="csv" href="list.php?key=' . $key . '&format=csv">pobierz CSV</a></div>';
  echo '<table><tr><th>termin</th><th>z kim</th><th>gość</th><th>kontakt</th><th>temat</th><th>stan</th><th></th></tr>';
  foreach ($rows as $r) {
    $off = !empty($r['cancelled_at']);
    echo '<tr class="' . ($off ? 'off' : '') . '">';
    echo '<td>' . $h($r['date']) . '<br><b>' . $h($r['from_t']) . '–' . $h($r['to_t']) . '</b> ' .
         '<span class="tag">' . (int)$r['minutes'] . " min</span></td>";
    echo '<td>' . $h($r['person_name']) . '</td>';
    echo '<td>' . $h($r['name']) . '<br><span class="tag">' . $h($r['company']) . '</span></td>';
    echo '<td><span class="tag">' . $h($r['email']) . '<br>' . $h($r['phone']) . '</span></td>';
    echo '<td><span class="tag">' . $h(mb_substr((string)$r['note'], 0, 70)) . '</span></td>';
    echo '<td><span class="tag">' . $h($r['calendar_state']) .
         ($off ? '<br>odwołana (' . $h($r['cancelled_by']) . ')' : '') . '</span></td>';
    echo '<td>' . ($off ? '' : '<a class="btn" href="cancel.php?key=' . $key . '&back=list&id=' . (int)$r['id'] .
         '" onclick="return confirm(\'Odwołać to spotkanie? Wydarzenie zniknie z kalendarza, kwadrans się zwolni.\')">odwołaj</a>') . '</td>';
    echo '</tr>';
  }
  echo '</table>';
  exit;
}
if (($_GET['format'] ?? '') === 'csv') {
  header('Content-Type: text/csv; charset=utf-8');
  header('Content-Disposition: attachment; filename="ifa-bookings.csv"');
  $out = fopen('php://output', 'w');
  if ($rows) fputcsv($out, array_keys($rows[0]));
  foreach ($rows as $r) fputcsv($out, array_map(fn($v) => defuse_formula((string)$v), $r));
  exit;
}
json_out(['ok' => true, 'count' => count($rows), 'bookings' => $rows]);
