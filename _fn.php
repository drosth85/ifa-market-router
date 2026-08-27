<?php require_once __DIR__.'/_bootstrap.php';
json_out(['litespeed'=>function_exists('litespeed_finish_request'),'fastcgi'=>function_exists('fastcgi_finish_request'),'sapi'=>php_sapi_name()]);
