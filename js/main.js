/* ===========================================================
   BUSAN FASHION WEEK — interactions
   =========================================================== */
(function () {
  "use strict";

  /* ---- hero ready (kinetic title) ---- */
  requestAnimationFrame(function () {
    document.body.classList.add("is-ready");
  });

  /* ---- hero title safety net ----
     The kinetic title animates from translateY(110%) (hidden below an
     overflow:hidden line). If the animation timeline never advances
     (non-painting / backgrounded / capture contexts), the words can stay
     stuck in their hidden start state. After the intro should have finished,
     force every title word's animation to its visible end state. In a normal
     browser the animation is already done by then, so this is a no-op. */
  function settleHeroTitle() {
    var words = document.querySelectorAll(".hero__title .word");
    for (var i = 0; i < words.length; i++) {
      try {
        var anims = words[i].getAnimations ? words[i].getAnimations() : [];
        for (var j = 0; j < anims.length; j++) anims[j].finish();
      } catch (e) {}
    }
  }
  setTimeout(settleHeroTitle, 1800);

  /* ---- nav: solid after hero, drop hero color ---- */
  var nav = document.getElementById("nav");
  var hero = document.getElementById("top");
  function onScroll() {
    var hbottom = hero ? hero.offsetHeight - 90 : 400;
    var past = window.scrollY > hbottom;
    nav.setAttribute("data-solid", past ? "true" : "false");
    nav.setAttribute("data-hero", past ? "false" : "true");
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---- scroll reveal (scroll-event driven — robust across contexts) ---- */
  var reveals = [].slice.call(document.querySelectorAll(".r"));
  function reveal() {
    var vh = window.innerHeight || document.documentElement.clientHeight;
    for (var i = reveals.length - 1; i >= 0; i--) {
      var el = reveals[i];
      var r = el.getBoundingClientRect();
      if (r.top < vh * 0.92 && r.bottom > 0) {
        el.classList.add("in");
        reveals.splice(i, 1);
      }
    }
  }
  window.addEventListener("scroll", reveal, { passive: true });
  window.addEventListener("resize", reveal, { passive: true });
  window.addEventListener("load", reveal);
  reveal();
  setTimeout(reveal, 250);
  setTimeout(reveal, 1200);

  /* ---- subtle parallax on hero media ---- */
  var heroMedia = document.querySelector(".hero__media");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (heroMedia && !reduce) {
    window.addEventListener("scroll", function () {
      var y = window.scrollY;
      if (y < window.innerHeight) {
        heroMedia.style.transform = "translateY(" + y * 0.18 + "px) scale(1.05)";
      }
    }, { passive: true });
  }

  /* ---- brand filter tabs handled in site.js (config-driven render) ---- */

  /* ---- video play handled in site.js (config-driven) ---- */

  /* ---- mobile nav toggle (smooth-scroll fallback menu) ---- */
  var toggle = document.querySelector(".nav-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      document.querySelector(".nav-links").style.display =
        document.querySelector(".nav-links").style.display === "flex" ? "" : "flex";
    });
  }
})();
