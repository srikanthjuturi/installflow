/* Tiny helpers for the static mocks. No framework, no build. */
(function () {
  // [data-open="id"] opens a dialog (.scrim#id); [data-close] closes the nearest one.
  document.addEventListener("click", function (e) {
    var o = e.target.closest("[data-open]");
    if (o) { var d = document.getElementById(o.getAttribute("data-open")); if (d) d.classList.add("open"); e.preventDefault(); }
    var c = e.target.closest("[data-close]");
    if (c) { var s = c.closest(".scrim"); if (s) s.classList.remove("open"); }
    if (e.target.classList && e.target.classList.contains("scrim")) e.target.classList.remove("open");
    var t = e.target.closest("[data-toast]");
    if (t) { var el = document.getElementById("toast"); if (el) { el.textContent = t.getAttribute("data-toast"); el.classList.add("show"); setTimeout(function(){el.classList.remove("show")}, 2600); } }
    // tabs: [data-tab="name"] inside .tabs shows [data-pane="name"]
    var tb = e.target.closest("[data-tab]");
    if (tb) {
      var group = tb.closest("[data-tabs]") || document;
      group.querySelectorAll("[data-tab]").forEach(function (b) { b.classList.toggle("on", b === tb); });
      var scope = tb.closest("[data-scope]") || document;
      scope.querySelectorAll("[data-pane]").forEach(function (p) { p.classList.toggle("hide", p.getAttribute("data-pane") !== tb.getAttribute("data-tab")); });
    }
    // segmented control: [data-seg] children toggle .on
    var sg = e.target.closest(".seg button");
    if (sg) { sg.parentElement.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === sg); }); }
    // state switcher (loading / empty / error / data): [data-state="x"] shows [data-view="x"]
    var st = e.target.closest("[data-state]");
    if (st) {
      st.parentElement.querySelectorAll("[data-state]").forEach(function (b) { b.classList.toggle("on", b === st); });
      document.querySelectorAll("[data-view]").forEach(function (v) { v.classList.toggle("hide", v.getAttribute("data-view") !== st.getAttribute("data-state")); });
    }
  });
})();
