/* Task 09 mock helpers, layered on mock.js (which is untouched). Static mocks only; no framework. */
(function () {
  var doc = document;

  /* ---------- rail <-> pane sync, page title, URL hash ---------- */
  function syncNav(name) {
    // mock.js moves .on onto whichever [data-tab] was clicked. The rail has to stay lit
    // for the screen it stands for even when a back button or a table row did the clicking.
    doc.querySelectorAll("[data-tab]").forEach(function (b) {
      var inRail = !!b.closest(".rail");
      if (!inRail) { b.classList.remove("on"); return; }
      var also = (b.getAttribute("data-also") || "").split(/\s+/);
      b.classList.toggle("on", b.getAttribute("data-tab") === name || also.indexOf(name) > -1);
    });
    doc.querySelectorAll("[data-ttl]").forEach(function (t) {
      var on = t.getAttribute("data-ttl") === name;
      t.classList.toggle("hide", !on);
      if (on) {
        var h = t.querySelector("h1");
        var brand = doc.body.getAttribute("data-brand") || "Acme Appliances";
        if (h) doc.title = brand + " · " + h.textContent + " (mock)";
      }
    });
    var r = doc.querySelector(".rail.open"); if (r) r.classList.remove("open");
    window.scrollTo(0, 0);
  }
  doc.addEventListener("click", function (e) {
    var tb = e.target.closest("[data-tab]");
    if (tb) syncNav(tb.getAttribute("data-tab"));
    var m = e.target.closest("[data-menu]");
    if (m) { var rail = doc.querySelector(".rail:not(.hide)"); if (rail) rail.classList.toggle("open"); }
    if (!e.target.closest(".rail") && !e.target.closest("[data-menu]")) {
      var o = doc.querySelector(".rail.open"); if (o) o.classList.remove("open");
    }

    /* ---------- [data-show="group:token"] swaps [data-swap="group:token ..."] ---------- */
    var sh = e.target.closest("[data-show]");
    if (sh) {
      var tok = sh.getAttribute("data-show"), g = tok.split(":")[0];
      var scope = sh.closest("[data-swapscope]") || doc;
      scope.querySelectorAll("[data-swap]").forEach(function (el) {
        var toks = el.getAttribute("data-swap").split(/\s+/);
        var inGroup = toks.some(function (t) { return t.split(":")[0] === g; });
        if (inGroup) el.classList.toggle("hide", toks.indexOf(tok) === -1);
      });
    }

    /* ---------- dialog modes: [data-open] with data-mode / data-who ---------- */
    var op = e.target.closest("[data-open]");
    if (op) {
      var dlg = doc.getElementById(op.getAttribute("data-open"));
      if (dlg) {
        if (op.hasAttribute("data-mode")) dlg.setAttribute("data-mode", op.getAttribute("data-mode"));
        if (op.hasAttribute("data-who")) dlg.querySelectorAll(".who-name").forEach(function (n) { n.textContent = op.getAttribute("data-who"); });
        if (op.hasAttribute("data-amt")) dlg.querySelectorAll(".amt-v").forEach(function (n) { n.textContent = op.getAttribute("data-amt"); });
      }
    }
  });
  function fromHash() {
    var h = decodeURIComponent((location.hash || "").slice(1));
    if (!h) return;
    var t = doc.querySelector('[data-tab="' + h + '"]');
    if (t) t.click();
  }
  window.addEventListener("hashchange", fromHash);
  doc.addEventListener("DOMContentLoaded", function () {
    fromHash();
    renderQR();
    var first = doc.querySelector(".rail [data-tab].on");
    if (first && !location.hash) syncNav(first.getAttribute("data-tab"));
  });

  /* ---------- a QR-looking placeholder (not scannable) ---------- */
  function renderQR() {
    doc.querySelectorAll("[data-qr]").forEach(function (box) {
      var n = 29, seed = 7, cells = "";
      function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
      function finder(x, y) {
        return '<rect x="' + x + '" y="' + y + '" width="7" height="7" fill="#171a21"/><rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="5" height="5" fill="#fff"/><rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" fill="#171a21"/>';
      }
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        var inF = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
        if (!inF && rnd() > 0.52) cells += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="#171a21"/>';
      }
      box.innerHTML = '<svg viewBox="0 0 ' + n + ' ' + n + '" role="img" aria-label="Mock UPI QR code (not scannable)" shape-rendering="crispEdges">' +
        '<rect width="' + n + '" height="' + n + '" fill="#fff"/>' + cells + finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7) + '</svg>';
    });
  }
})();
