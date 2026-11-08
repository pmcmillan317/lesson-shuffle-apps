/* Lesson Shuffle apps site. No dependencies, no cookies, no network calls.
   1) Adds the "js" class (CSS only hides .reveal elements when this class is present).
   2) Reveals .reveal elements once as they scroll into view.
   3) Closes the phone menu on link click, Escape and outside click.
   Everything works without this file: the menu is a plain <details>, and nothing is hidden. */
(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("js");

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  /* ---- Phone menu ------------------------------------------------------------------------- */
  function initMenu() {
    var menu = document.querySelector("details.menu");
    if (!menu) return;
    var summary = menu.querySelector("summary");

    function close(returnFocus) {
      if (!menu.open) return;
      menu.open = false;
      if (returnFocus && summary) summary.focus();
    }

    menu.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("a") : null;
      if (link) close(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && menu.open) close(menu.contains(document.activeElement));
    });
    document.addEventListener("click", function (event) {
      if (menu.open && !menu.contains(event.target)) close(false);
    });
    // Coming back with the Back button should not show an open menu.
    window.addEventListener("pageshow", function () { menu.open = false; });
  }

  /* ---- Reveal on scroll ------------------------------------------------------------------- */
  function initReveal() {
    var items = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
    if (!items.length) return;

    function show(el) { el.classList.add("is-in"); }
    function showAll() { items.forEach(show); }

    var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if ((reduce && reduce.matches) || !("IntersectionObserver" in window)) {
      showAll();
      return;
    }
    if (reduce && reduce.addEventListener) {
      reduce.addEventListener("change", function (event) { if (event.matches) showAll(); });
    }
    window.addEventListener("beforeprint", showAll);

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          show(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0 });

    // Anything already on screen at load is revealed right away (one frame later, so the
    // start state is painted first and the slide-up is visible). The rest wait for scrolling.
    var height = window.innerHeight || root.clientHeight;
    var onScreen = [];
    items.forEach(function (el) {
      var box = el.getBoundingClientRect();
      if (box.top < height && box.bottom > 0) onScreen.push(el);
      else observer.observe(el);
    });
    if (onScreen.length) {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () { onScreen.forEach(show); });
      });
    }

    // Failsafe: whatever is still hidden after 4 seconds is shown.
    window.setTimeout(showAll, 4000);
  }

  ready(function () {
    initMenu();
    initReveal();
  });
})();
