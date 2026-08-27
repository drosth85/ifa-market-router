<?php
require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_domain.php';
require_once __DIR__ . '/_calendar.php';

$ts  = $_SERVER['HTTP_X_SYNC_TS'] ?? '';
$sig = $_SERVER['HTTP_X_SYNC_SIG'] ?? '';
if (!is_numeric($ts) || abs(time() - (int)$ts) > 300 ||
    !hash_equals(hash_hmac('sha256', $ts . '.retry', (string)cfg('sync_key')), (string)$sig)) {
  json_out(['ok' => false, 'reason' => 'auth'], 403);
}

$now = now_berlin()->format('c');
$rows = db()->prepare("SELECT id FROM bookings WHERE calendar_state = 'pending'
                       AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY id LIMIT 5");
$rows->execute([$now]);
$ids = array_column($rows->fetchAll(), 'id');
foreach ($ids as $id) settle_calendar((int)$id);
json_out(['ok' => true, 'retried' => count($ids)]);
