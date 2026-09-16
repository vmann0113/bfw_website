<?php
/* =====================================================================
   알리고 중계 (PHP 한 장)

   왜 필요한가
     알리고는 API 를 호출하는 서버의 IP 를 화이트리스트로 막는다.
     홈페이지는 Vercel 에서 도는데, 그쪽 IP 는 수시로 바뀌어 등록이
     불가능하다. 그래서 IP 가 고정된 이 파일을 한 번 거쳐서 보낸다.

   두는 곳
     고정 IP 를 가진 웹호스팅 아무 곳. PHP 와 curl 만 되면 된다.
     올린 뒤 그 서버의 IP 를 알리고 '발송 서버 IP' 에 등록한다.
     서버 IP 는 아래 주소로 확인할 수 있다.
        https://내주소/aligo-relay.php?ip=1

   안전장치
     · 정해둔 열쇠(X-Relay-Secret)가 맞지 않으면 받지 않는다
     · 알리고 주소로만 보낸다 — 아무 데나 보내는 통로가 되지 않게
     · 알리고 API 키를 이 파일에 저장하지 않는다. 요청마다 실려 온다.

   설정
     아래 $SECRET 을 홈페이지 환경변수 ALIGO_RELAY_SECRET 과 같은 값으로.
   ===================================================================== */

$SECRET = 'cbde8b1ff0691760c72fa0941221c4f4aa3b5f29c30c48e5';

header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex');

/* 서버 IP 확인용 — 알리고에 등록할 주소를 알기 위해서다.
   서버의 공개 IP 는 이미 공개된 정보라 열쇠를 요구하지 않는다. */
if (isset($_GET['ip'])) {
    $ip = @file_get_contents('https://api.ipify.org');
    echo json_encode([
        'outboundIp' => $ip ?: null,
        'serverAddr' => $_SERVER['SERVER_ADDR'] ?? null,
        'note' => '이 주소를 알리고 발송 서버 IP 에 등록하세요',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only'], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($SECRET === '') {
    http_response_code(500);
    echo json_encode(['error' => '중계 열쇠가 설정되지 않았습니다'], JSON_UNESCAPED_UNICODE);
    exit;
}

$given = $_SERVER['HTTP_X_RELAY_SECRET'] ?? '';
if (!is_string($given) || !hash_equals($SECRET, $given)) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized'], JSON_UNESCAPED_UNICODE);
    exit;
}

$in = json_decode(file_get_contents('php://input'), true);
$url  = is_array($in) ? ($in['url']  ?? '') : '';
$form = is_array($in) ? ($in['form'] ?? '') : '';

/* 알리고 주소만 허용한다. 이게 없으면 누구나 이 서버를 통해 아무 곳에나
   요청을 보낼 수 있는 열린 통로가 된다. */
if (!preg_match('#^https://(apis\.aligo\.in|kakaoapi\.aligo\.in)/#', $url)) {
    http_response_code(400);
    echo json_encode(['error' => '허용되지 않은 주소입니다'], JSON_UNESCAPED_UNICODE);
    exit;
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $form,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded; charset=utf-8'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 25,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);
$body = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($body === false) {
    http_response_code(502);
    echo json_encode(['error' => 'relay failed', 'detail' => $err], JSON_UNESCAPED_UNICODE);
    exit;
}

/* 알리고의 응답을 그대로 돌려준다 — 홈페이지는 직접 부른 것처럼 처리한다 */
http_response_code($code ?: 200);
echo $body;
