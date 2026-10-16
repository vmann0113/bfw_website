/* 입구 화면만 따로 담아 두는 저장소.
   인터넷이 끊긴 채로 새로고침해도 화면이 뜨게 하는 것이 목적이다.

   담는 것은 입구 화면에 쓰이는 파일뿐이다. 다른 페이지와 Supabase
   호출은 손대지 않고 그대로 통과시킨다.
   늘 서버를 먼저 보고, 닿지 않을 때만 담아둔 것을 내준다. 그래서
   화면을 고쳐 올리면 다음 접속에서 바로 새것이 받아진다. */
var CACHE = "bfw-gate-v1";
var FILES = ["gate.html", "js/config.js", "js/api.js", "js/gate.js"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(FILES); })
      .catch(function () {})
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var u;
  try { u = new URL(e.request.url); } catch (err) { return; }
  if (u.origin !== self.location.origin) return;          // Supabase 등 바깥 호출은 그대로
  if (e.request.method !== "GET") return;

  var path = u.pathname.replace(/^\//, "");
  var mine = FILES.some(function (f) { return path === f || path.endsWith("/" + f); });
  if (!mine) return;                                       // 다른 페이지는 건드리지 않는다

  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match(path) || Response.error();
      });
    })
  );
});
