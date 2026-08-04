/* ===========================================================
   BUSAN FASHION WEEK — member auth UI (간편 회원가입 · 로그인)
   Mounts an account chip into #acctSlot and provides a
   login/signup sheet. State via BFWApi.member* (dual-mode).
   Fires window event "bfw:member" (detail = member | null).
   =========================================================== */
(function () {
  "use strict";
  var Api = window.BFWApi;
  var css = ".au-slot{display:flex;align-items:center;gap:10px;font-family:var(--kr)}" +
    ".au-hello{font-size:.88rem;color:var(--ink-soft)}.au-hello b{font-weight:700}" +
    ".au-link{font-family:var(--kr);font-weight:600;font-size:.86rem;color:var(--ink);background:var(--paper-2);border:1px solid var(--line);border-radius:999px;padding:9px 18px;cursor:pointer;transition:all .16s}" +
    ".au-link:hover{border-color:var(--ocean);color:var(--ocean)}" +
    ".au-out{font-family:var(--mono);font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-mute);background:none;border:0;cursor:pointer;padding:4px}.au-out:hover{color:var(--coral)}" +
    ".au-ov{position:fixed;inset:0;background:color-mix(in oklch,var(--ink) 55%,transparent);backdrop-filter:blur(4px);z-index:90;display:none;align-items:flex-start;justify-content:center;overflow-y:auto;padding:clamp(20px,8vh,80px) 16px 60px}" +
    ".au-ov.show{display:flex}" +
    ".au-card{background:var(--paper);border-radius:22px;width:min(420px,100%);padding:clamp(24px,4vw,36px);box-shadow:0 30px 80px -20px rgba(0,0,0,.5)}" +
    ".au-card h2{font-family:var(--disp);font-weight:800;font-size:1.7rem;text-transform:uppercase;margin:0;line-height:.95}" +
    ".au-sub{font-family:var(--kr);color:var(--ink-mute);font-size:.88rem;margin:8px 0 0}" +
    ".au-x{float:right;font-family:var(--mono);font-size:.74rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-mute);background:none;border:0;cursor:pointer;padding:4px}.au-x:hover{color:var(--coral)}" +
    ".au-tabs{display:inline-flex;gap:4px;margin:18px 0 4px;background:var(--paper-2);border:1px solid var(--line);border-radius:10px;padding:3px}" +
    ".au-tabs button{font-family:var(--kr);font-weight:600;font-size:.84rem;color:var(--ink-mute);border:0;background:transparent;border-radius:8px;padding:8px 16px;cursor:pointer}" +
    ".au-tabs button.on{background:var(--ink);color:var(--paper)}" +
    ".au-form{margin-top:14px;display:flex;flex-direction:column;gap:12px}" +
    ".au-f label{display:block;font-family:var(--kr);font-size:.8rem;font-weight:600;margin-bottom:6px}.au-f label .req{color:var(--coral)}.au-f label .mut{color:var(--ink-mute);font-weight:400}" +
    ".au-f input{width:100%;box-sizing:border-box;font-family:var(--kr);font-size:.94rem;color:var(--ink);background:var(--paper-2);border:1px solid var(--line);border-radius:10px;padding:12px 14px}" +
    ".au-f input:focus{outline:none;border-color:var(--ocean);box-shadow:0 0 0 3px color-mix(in oklch,var(--ocean) 16%,transparent)}" +
    ".au-agree{display:flex;align-items:flex-start;gap:10px;font-family:var(--kr);font-size:.82rem;color:var(--ink-soft)}.au-agree input{width:17px;height:17px;margin-top:1px;flex:none;accent-color:var(--ocean)}" +
    ".au-err{color:var(--coral);font-family:var(--kr);font-size:.8rem;display:none}.au-err.show{display:block}";
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function current() { return Api.memberCurrent(); }
  function emit() { try { window.dispatchEvent(new CustomEvent("bfw:member", { detail: current() })); } catch (e) {} }

  var slot = document.getElementById("acctSlot");
  function renderSlot() {
    if (!slot) return;
    var m = current();
    slot.className = "au-slot";
    if (m) {
      slot.innerHTML = '<span class="au-hello"><b>' + esc(m.name) + '</b>님</span><button class="au-out" type="button">로그아웃</button>';
      slot.querySelector(".au-out").addEventListener("click", function () {
        Api.memberSignOut().then(function () { renderSlot(); emit(); });
      });
    } else {
      slot.innerHTML = '<button class="au-link" type="button">로그인 · 간편가입</button>';
      slot.querySelector(".au-link").addEventListener("click", function () { open("in"); });
    }
  }

  var ov = null;
  function q(root, sel) { return root.querySelector(sel); }
  function showErr(el, msg) { el.textContent = msg; el.classList.add("show"); }
  function busy(f, on) {
    var b = f.querySelector("button[type=submit]");
    b.disabled = on;
    if (on) { b.dataset.l = b.innerHTML; b.innerHTML = "처리 중…"; }
    else if (b.dataset.l) b.innerHTML = b.dataset.l;
  }
  function setMode(m) {
    ov.querySelectorAll(".au-tabs button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-m") === m); });
    q(ov, "[data-form=in]").style.display = m === "in" ? "" : "none";
    q(ov, "[data-form=up]").style.display = m === "up" ? "" : "none";
  }
  function build() {
    if (ov) return;
    ov = document.createElement("div");
    ov.className = "au-ov";
    ov.innerHTML =
      '<div class="au-card">' +
        '<button class="au-x" type="button">닫기 ✕</button>' +
        '<h2>Account</h2><p class="au-sub">회원은 예약·신청 시 정보가 자동 입력되고, 내 예약을 바로 확인할 수 있습니다.</p>' +
        '<div class="au-tabs"><button type="button" data-m="in" class="on">로그인</button><button type="button" data-m="up">간편가입</button></div>' +
        '<form class="au-form" data-form="in">' +
          '<div class="au-f"><label>연락처 <span class="req">*</span></label><input type="tel" name="phone" placeholder="010-0000-0000" autocomplete="tel"></div>' +
          '<div class="au-f"><label>비밀번호 <span class="req">*</span></label><input type="password" name="pw" autocomplete="current-password"></div>' +
          '<div class="au-err"></div>' +
          '<button type="submit" class="btn primary" style="align-self:flex-start">로그인 <span>→</span></button>' +
        '</form>' +
        '<form class="au-form" data-form="up" style="display:none">' +
          '<div class="au-f"><label>이름 <span class="req">*</span></label><input type="text" name="name" placeholder="홍길동"></div>' +
          '<div class="au-f"><label>연락처 <span class="req">*</span></label><input type="tel" name="phone" placeholder="010-0000-0000" autocomplete="tel"></div>' +
          '<div class="au-f"><label>비밀번호 <span class="req">*</span> <span class="mut">· 6자 이상</span></label><input type="password" name="pw" autocomplete="new-password"></div>' +
          '<div class="au-f"><label>이메일 <span class="mut">(선택)</span></label><input type="email" name="email" placeholder="name@email.com"></div>' +
          '<label class="au-agree"><input type="checkbox" name="agree"><span>개인정보 수집·이용에 동의합니다. 예약 확인 및 행사 안내 목적으로만 사용됩니다. <span class="req">*</span></span></label>' +
          '<div class="au-err"></div>' +
          '<button type="submit" class="btn primary" style="align-self:flex-start">가입하고 시작하기 <span>→</span></button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(ov);
    q(ov, ".au-x").addEventListener("click", close);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.querySelectorAll(".au-tabs button").forEach(function (b) {
      b.addEventListener("click", function () { setMode(b.getAttribute("data-m")); });
    });
    var fIn = q(ov, "[data-form=in]");
    fIn.addEventListener("submit", function (e) {
      e.preventDefault();
      var phone = q(fIn, "[name=phone]").value.trim(), pw = q(fIn, "[name=pw]").value;
      var err = q(fIn, ".au-err");
      err.classList.remove("show");
      if (!phone || !pw) return showErr(err, "연락처와 비밀번호를 입력해 주세요.");
      busy(fIn, true);
      Api.memberSignIn(phone, pw).then(function (r) {
        busy(fIn, false);
        if (r.ok) { close(); renderSlot(); emit(); }
        else if (r.reason === "nomember") showErr(err, "가입되지 않은 연락처입니다. 간편가입을 이용해 주세요.");
        else if (r.reason === "network") showErr(err, "네트워크 오류 — 잠시 후 다시 시도해 주세요.");
        else showErr(err, "연락처 또는 비밀번호가 올바르지 않습니다.");
      });
    });
    var fUp = q(ov, "[data-form=up]");
    fUp.addEventListener("submit", function (e) {
      e.preventDefault();
      var err = q(fUp, ".au-err");
      var name = q(fUp, "[name=name]").value.trim(), phone = q(fUp, "[name=phone]").value.trim();
      var pw = q(fUp, "[name=pw]").value, email = q(fUp, "[name=email]").value.trim();
      err.classList.remove("show");
      if (!name || !phone || !pw) return showErr(err, "이름·연락처·비밀번호를 입력해 주세요.");
      if (pw.length < 6) return showErr(err, "비밀번호는 6자 이상으로 해주세요.");
      if (!q(fUp, "[name=agree]").checked) return showErr(err, "개인정보 수집·이용 동의가 필요합니다.");
      busy(fUp, true);
      Api.memberSignUp({ name: name, phone: phone, email: email, password: pw }).then(function (r) {
        busy(fUp, false);
        if (r.ok) { close(); renderSlot(); emit(); }
        else if (r.reason === "dup") showErr(err, "이미 가입된 연락처입니다. 로그인해 주세요.");
        else if (r.reason === "network") showErr(err, "네트워크 오류 — 잠시 후 다시 시도해 주세요.");
        else showErr(err, "가입에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      });
    });
  }
  function open(m) {
    build();
    setMode(m || "in");
    ov.classList.add("show");
    document.body.style.overflow = "hidden";
  }
  function close() {
    if (ov) { ov.classList.remove("show"); document.body.style.overflow = ""; }
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  renderSlot();
  window.BFWAuth = { current: current, open: open };
})();
