/* Lesson Shuffle apps site. No dependencies, no cookies. It sends anonymous counts (a label and the page path, nothing about the visitor) for clicks and campaign visits.
   1) Adds the "js" class (CSS only hides .reveal elements when this class is present).
   2) Reveals .reveal elements once as they scroll into view.
   3) Closes the phone menu on link click, Escape and outside click.
   4) Opens the small coffee tip dialog (QR code and a button) from links marked data-coffee.
   5) Counts clicks (data-track labels, email, downloads, links to other sites) and campaign visits (see initTrack).
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

  /* ---- Coffee dialog ---------------------------------------------------------------------- */
  // A link marked data-coffee opens a small tip dialog: a QR code and an "Open Venmo" button. Both go to
  // /coffee/, which redirects to the tip page (see _redirects), so the destination can change without
  // touching this file. With no script, or no <dialog> support, the link simply goes to /coffee/.
  function initCoffee() {
    var links = Array.prototype.slice.call(document.querySelectorAll("a[data-coffee]"));
    if (!links.length) return;
    var dialog = document.createElement("dialog");
    if (typeof dialog.showModal !== "function") return;

    function make(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    }

    dialog.className = "coffee-dialog";
    dialog.setAttribute("aria-labelledby", "coffee-title");

    var tabs = make("div", "tabs");
    tabs.setAttribute("aria-hidden", "true");
    for (var t = 0; t < 4; t++) tabs.appendChild(document.createElement("i"));

    var body = make("div", "coffee-body");
    var title = make("h2", "", "Buy me a coffee");
    title.id = "coffee-title";
    var qr = make("img", "coffee-qr");
    qr.src = "/assets/coffee-qr.svg";
    qr.width = 220;
    qr.height = 220;
    qr.alt = "QR code. Scan it with your phone's camera to open my Venmo tip page.";
    var actions = make("div", "coffee-actions");
    var go = make("a", "btn btn-main", "Open Venmo");
    go.href = "/coffee/";
    go.target = "_blank";
    go.rel = "noopener";
    go.appendChild(make("span", "visually-hidden", " (opens in a new tab)"));
    var close = make("button", "btn btn-ghost", "Close");
    close.type = "button";
    actions.appendChild(go);
    actions.appendChild(close);
    var fine = make("p", "coffee-fine", "Venmo, US only.");
    [title, qr, actions, fine].forEach(function (node) { body.appendChild(node); });
    dialog.appendChild(tabs);
    dialog.appendChild(body);

    var opener = null;
    close.addEventListener("click", function () { dialog.close(); });
    // Clicking the dimmed area outside the box closes it (the box itself has no padding of its own).
    dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", function () { if (opener && opener.focus) opener.focus(); });

    links.forEach(function (link) {
      link.addEventListener("click", function (event) {
        // Let a new-tab click (Ctrl, Cmd, Shift, middle button) go straight to the link.
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        opener = link;
        if (!dialog.open) dialog.showModal();
      });
    });
    document.body.appendChild(dialog);
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

  /* ---- Click counts ----------------------------------------------------------------------- */
  // Anonymous counts, sent only as a label and the page path (and, for a campaign link, the utm source, medium
  // and campaign). Nothing about the visitor. It never blocks or delays a link. A pressed link is labelled, in this order:
  // its data-track label; "email" for a mailto: link; "download:<file name>" for a download or a .pdf .png .jpg .zip
  // .docx .pptx link; "out:<host>" for a link to any site other than lessonshuffle.com, www, apps or cards.
  // New links are counted automatically. A visit that arrives with utm_source or utm_campaign sends one "campaign" count.
  function initTrack() {
    if (!navigator.sendBeacon) return;
    var own = ["lessonshuffle.com", "www.lessonshuffle.com", "apps.lessonshuffle.com", "cards.lessonshuffle.com"];

    function post(body) {
      try {
        navigator.sendBeacon("https://lessonshuffle.com/api/track", new Blob([JSON.stringify(body)], { type: "text/plain" }));
      } catch (err) { /* counting is optional */ }
    }
    function clean(text) {
      return String(text).toLowerCase().replace(/[^a-z0-9:._\/-]/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 80);
    }
    function labelFor(link) {
      var tag = link.getAttribute("data-track");
      if (tag) return tag;
      if (/^mailto:/i.test(link.getAttribute("href") || "")) return "email";
      var url;
      try { url = new URL(link.href, location.href); } catch (err) { return ""; }
      if (!/^https?:$/.test(url.protocol)) return "";
      if (link.hasAttribute("download") || /\.(pdf|png|jpg|zip|docx|pptx)$/i.test(url.pathname)) {
        var file = url.pathname.split("/").pop() || "file";
        try { file = decodeURIComponent(file); } catch (err) { /* keep the raw name */ }
        return "download:" + file;
      }
      if (url.hostname !== location.hostname && own.indexOf(url.hostname) === -1) return "out:" + url.hostname;
      return "";
    }
    function send(event) {
      try {
        var link = event.target.closest ? event.target.closest("a") : null;
        if (!link) return;
        var label = clean(labelFor(link));
        if (label) post({ e: label, p: location.pathname });
      } catch (err) { /* counting is optional */ }
    }
    document.addEventListener("click", send);
    document.addEventListener("auxclick", send);

    try {
      var q = new URLSearchParams(location.search);
      var val = function (k) { return (q.get(k) || "").trim().toLowerCase().slice(0, 60); };
      var s = val("utm_source"), m = val("utm_medium"), c = val("utm_campaign");
      if (s || c) {
        var u = {};
        if (s) u.s = s;
        if (m) u.m = m;
        if (c) u.c = c;
        post({ e: "campaign", p: location.pathname, u: u });
      }
    } catch (err) { /* counting is optional */ }
  }

  ready(function () {
    initMenu();
    initReveal();
    initCoffee();
    initTrack();
  });
})();
