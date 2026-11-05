// Applies the saved theme and language before first paint (kept as an external file so the CSP can forbid inline scripts).
(function () {
  try {
    var pref = localStorage.getItem('quest.theme') || 'system';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    var lang = localStorage.getItem('quest.lang') === 'ar' ? 'ar' : 'en';
    root.setAttribute('lang', lang);
    root.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  } catch (e) {}
})();
