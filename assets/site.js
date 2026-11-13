/* Vigrel site behaviour: nav, staggered text reveals, micro-motion.
   No dependencies, no network. Motion is transform/opacity only. */
(function () {
  "use strict";

  document.documentElement.classList.add("js");

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- account link
  // The account service is a separate origin; one config value points at it.
  var CFG = window.VIGREL_CONFIG || {};
  var accountUrl = String(CFG.accountUrl || "").replace(/\/$/, "");
  if (accountUrl) {
    document.querySelectorAll("[data-account-link]").forEach(function (a) {
      a.href = accountUrl + (a.getAttribute("data-account-link") || "/login");
    });
    var checkoutUrl = String(CFG.checkoutUrl || "").replace(/\/$/, "");
    document.querySelectorAll("[data-checkout]").forEach(function (a) {
      if (!checkoutUrl) { a.remove(); return; }
      a.href = checkoutUrl + "/buy/" + a.getAttribute("data-checkout");
    });
    var nav = document.querySelector(".nav-links");
    if (nav && !nav.querySelector(".nav-signin")) {
      var signin = document.createElement("a");
      signin.className = "nav-signin";
      signin.href = accountUrl + "/login";
      signin.textContent = "Sign in";
      var cta = nav.querySelector(".nav-cta");
      nav.insertBefore(signin, cta || null);
    }
  }

  // ---- mobile nav
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") links.classList.remove("open");
    });
  }

  if (reduce) {
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
    return;
  }

  // ---- tag blocks for animation.
  // Groups stagger as a unit; standalone blocks animate on their own.
  var groups = [
    [".hero-copy > *", 90],
    [".hero-plate", 0],
    [".section-head > div > *", 70],
    [".grid-3 > .card", 80],
    [".grid-2 > .card", 80],
    [".grid-4 > .card", 70],
    [".plans > .plan", 90],
    [".dl-grid > .dl-card", 90],
    [".row-copy > *", 70],
    [".row-media > .plate", 0],
    [".table-wrap", 0],
    [".note", 0],
    [".faq details", 55],
    [".foot-grid > div", 60]
  ];

  var seen = new WeakSet();
  groups.forEach(function (pair) {
    document.querySelectorAll(pair[0]).forEach(function (el, i) {
      if (seen.has(el)) return;
      seen.add(el);
      el.setAttribute("data-anim", "");
      var d = Math.min(i * pair[1], 520);
      if (d) el.style.setProperty("--d", d + "ms");
    });
  });

  // legacy .reveal blocks from older markup
  document.querySelectorAll(".reveal").forEach(function (el) {
    if (!seen.has(el)) { el.setAttribute("data-anim", ""); seen.add(el); }
  });

  var items = document.querySelectorAll("[data-anim]");
  if (!("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("in"); });
    return;
  }

  // Reveal whatever is already on screen immediately: the first paint should
  // never depend on an observer callback being delivered.
  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.top < window.innerHeight * 1.05 && r.bottom > -40;
  }
  items.forEach(function (el) { if (inView(el)) el.classList.add("in"); });

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in");
      io.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px 8% 0px", threshold: 0.01 });

  items.forEach(function (el) { if (!el.classList.contains("in")) io.observe(el); });

  // Failsafe: never leave copy invisible, whatever the observer does.
  window.setTimeout(function () {
    items.forEach(function (el) { el.classList.add("in"); });
  }, 2500);
})();
