/* Drift — theme.js
 *
 * Loaded synchronously from <head>, before anything paints, so the page never
 * flashes the wrong colours. It does two jobs:
 *
 *   1. Pick a theme on the first visit. The operating system's own setting is
 *      the strongest signal and the stylesheet already honours it through
 *      prefers-color-scheme, so this only steps in to force dark after dark
 *      outside. Someone opening the page at eleven at night on a machine
 *      that never got switched out of light mode still gets a dark page.
 *   2. Wire the header button, and remember whatever is chosen from then on.
 *
 * Nothing here is essential: with JavaScript off, or with storage blocked, the
 * stylesheet's own media query still gives a correct light or dark page.
 */
(function () {
  "use strict";

  var KEY = "drift:theme";
  var DARK_FROM = 19, DARK_UNTIL = 7;     // local hours

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return (v === "light" || v === "dark") ? v : null;
    } catch (e) {
      return null;                        // private window, blocked storage
    }
  }

  function remember(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* nothing to do */ }
  }

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function isNight() {
    var h = new Date().getHours();
    return h >= DARK_FROM || h < DARK_UNTIL;
  }

  /** What the page is actually showing, whether or not we set it. */
  function current() {
    var set = document.documentElement.getAttribute("data-theme");
    if (set) return set;
    return systemPrefersDark() ? "dark" : "light";
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute("content", theme);
    paintButton();
    // The canvases are painted by hand and do not follow CSS, so let whoever
    // drew them know the surface colour underneath has changed.
    window.dispatchEvent(new CustomEvent("drift:themechange", { detail: theme }));
  }

  // --- the early part: runs now, before the body exists ------------------
  var choice = stored();
  if (choice) {
    document.documentElement.setAttribute("data-theme", choice);
  } else if (isNight() && !systemPrefersDark()) {
    // After hours on a light-mode machine. Not remembered: it is a guess
    // about the time, not a decision the reader made.
    document.documentElement.setAttribute("data-theme", "dark");
  }
  // Otherwise no attribute at all, so the stylesheet's media query decides
  // and the page keeps following the system if that setting changes.

  var SUN = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.4v2.2M12 19.4v2.2M4.2 12H2M22 12h-2.2M6.1 6.1 4.6 4.6M19.4 19.4l-1.5-1.5M17.9 6.1l1.5-1.5M4.6 19.4l1.5-1.5"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8z"/></svg>';

  function paintButton() {
    var btn = document.getElementById("themeBtn");
    if (!btn) return;
    var dark = current() === "dark";
    // The button shows where it will take you, not where you are.
    btn.innerHTML = dark ? SUN : MOON;
    btn.setAttribute("aria-label", dark ? "Switch to the light theme" : "Switch to the dark theme");
    btn.title = btn.getAttribute("aria-label");
  }

  function wire() {
    var btn = document.getElementById("themeBtn");
    if (!btn) return;
    paintButton();
    btn.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      remember(next);
      apply(next);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }

  // Follow the system while the reader has not expressed a preference.
  if (!stored() && window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onChange = function () {
      if (stored()) return;
      document.documentElement.removeAttribute("data-theme");
      paintButton();
      window.dispatchEvent(new CustomEvent("drift:themechange", { detail: current() }));
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  window.DriftTheme = { current: current };
})();
