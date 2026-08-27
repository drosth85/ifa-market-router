<?php
require_once __DIR__ . '/_bootstrap.php';
cors();
json_out([
  'ok' => true, 'php' => PHP_VERSION,
  'bookings' => (int)db()->query('SELECT COUNT(*) c FROM bookings')->fetch()['c'],
  'pending' => (int)db()->query("SELECT COUNT(*) c FROM bookings WHERE calendar_state='pending'")->fetch()['c'],
  'last_push_at' => meta_get('last_push_at'),
  'now' => now_berlin()->format('c'),
]);
