/* Huddle Up demo page: the teacher page and a few student pages side by side in one tab.
   Both pages are this site's own, so this page can read the room code from the teacher frame and fill in the
   student join forms. Each student frame gets its own seat number so their saved seats do not collide.
   The game itself runs exactly as it does in class, through the same relay. */
(function () {
  "use strict";
  var HU = window.HU;
  var $ = HU.$, h = HU.h;
  var hostFrame, phones, countBox, rejoin;
  var code = "";
  var made = false;

  function hostDoc() {
    try { return hostFrame.contentDocument; } catch (e) { return null; }
  }

  // Hide the teacher page's site header inside the frame, and start with 2 teams so a few phones make a real game.
  function prepHost() {
    var d = hostDoc();
    if (!d || !d.documentElement) return;
    d.documentElement.classList.add("hu-in-demo");
    var teams = d.getElementById("hu-teamcount");
    if (teams && !teams.dataset.demo) {
      teams.dataset.demo = "1";
      if (teams.value === "0") {
        teams.value = "2";
        teams.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }

  function readCode() {
    var d = hostDoc();
    var el = d && d.getElementById("hu-code");
    var lobby = d && d.getElementById("hu-lobby");
    var text = el ? el.textContent.replace(/\s/g, "") : "";
    // The code shows once a room is open. Keep it after the lobby too, so phones stay in the game.
    if (text && HU.CODE_RE.test(text)) return text;
    if (lobby && !lobby.hidden) return "";
    return code;
  }

  function sizePhones() {
    var frames = phones.querySelectorAll(".dm-phone");
    if (!frames.length) return;
    var box = phones.getBoundingClientRect();
    var n = frames.length;
    var cols = n <= 2 ? n : n <= 4 ? 2 : 3;
    if (box.width / cols < 180 && cols > 1) cols--;
    var rows = Math.ceil(n / cols);
    var gap = 12;
    var w = (box.width - gap * (cols - 1)) / cols;
    var hgt = (box.height - gap * (rows - 1)) / rows - 26; // room for the "Student 1" label
    // Each phone is drawn at 375 by 700 and shrunk to fit its cell.
    var scale = Math.min(w / 375, hgt / 700, 1);
    phones.style.setProperty("--cols", String(cols));
    phones.style.setProperty("--s", String(Math.max(0.3, scale)));
  }

  function joinFrame(frame, i) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var d;
      try { d = frame.contentDocument; } catch (e) { d = null; }
      var form = d && d.getElementById("pl-form");
      var nick = d && d.getElementById("pl-nick");
      var app = d && d.getElementById("pl-app");
      if (app && !app.hidden) { clearInterval(timer); return; }
      if (form && nick && !d.getElementById("pl-join").hidden) {
        clearInterval(timer);
        nick.value = HU.randomName();
        if (form.requestSubmit) form.requestSubmit(); else form.querySelector("[type=submit]").click();
      }
      if (tries > 50) clearInterval(timer);
    }, 200);
  }

  function makePhones() {
    HU.clear(phones);
    var n = parseInt(countBox.value, 10) || 4;
    if (!code) {
      phones.appendChild(h("p", { class: "dm-wait", text: "Open a room on the teacher screen and the students will join here." }));
      made = false;
      rejoin.disabled = true;
      return;
    }
    for (var i = 1; i <= n; i++) {
      var frame = h("iframe", { class: "dm-frame", title: "Student " + i, src: "/join/?code=" + encodeURIComponent(code) + "&seat=" + i });
      (function (f, k) { f.addEventListener("load", function () { joinFrame(f, k); }); })(frame, i);
      phones.appendChild(h("div", { class: "dm-phone" }, h("p", { class: "dm-label", text: "Student " + i }), h("div", { class: "dm-screen" }, frame)));
    }
    made = true;
    rejoin.disabled = false;
    sizePhones();
  }

  function clearSeats() {
    for (var i = 1; i <= 9; i++) HU.store.remove("sessionStorage", "huddle.me." + i);
  }

  function tick() {
    prepHost();
    var now = readCode();
    if (now !== code) {
      code = now;
      clearSeats();
      makePhones();
    } else if (code && !made) makePhones();
  }

  function boot() {
    hostFrame = $("#dm-host");
    phones = $("#dm-phones");
    countBox = $("#dm-count");
    rejoin = $("#dm-rejoin");
    hostFrame.addEventListener("load", prepHost);
    countBox.addEventListener("change", function () { clearSeats(); makePhones(); });
    rejoin.addEventListener("click", function () { clearSeats(); makePhones(); });
    window.addEventListener("resize", sizePhones);
    clearSeats();
    setInterval(tick, 700);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
