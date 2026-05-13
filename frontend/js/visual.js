// ── Visual polish for the native app ─────────────────────────────────────────
// Wires up @capacitor/status-bar, @capacitor/haptics and @capacitor/splash-screen
// when running inside the APK. On web, every method is a graceful no-op.
const Visual = (() => {
  const isNative = !!(window.Capacitor?.isNativePlatform?.());

  // ── Status bar : match the app's dark theme ───────────────────────────────
  function setupStatusBar() {
    if (!isNative) return;
    const SB = window.Capacitor.Plugins.StatusBar;
    if (!SB) return;
    SB.setStyle({ style: 'DARK' }).catch(() => {});               // white icons
    SB.setBackgroundColor({ color: '#070c18' }).catch(() => {});  // matches --bg
    SB.setOverlaysWebView({ overlay: false }).catch(() => {});    // don't overlap
  }

  // ── Splash screen : hide once the app is ready ────────────────────────────
  function hideSplash() {
    if (!isNative) return;
    const Splash = window.Capacitor.Plugins.SplashScreen;
    if (!Splash) return;
    Splash.hide({ fadeOutDuration: 250 }).catch(() => {});
  }

  // ── Haptic feedback (vibration) ───────────────────────────────────────────
  // styles: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection'
  function haptic(style = 'light') {
    if (!isNative) return;
    const H = window.Capacitor.Plugins.Haptics;
    if (!H) return;
    try {
      if (style === 'success' || style === 'warning' || style === 'error') {
        H.notification({ type: style.toUpperCase() }).catch(() => {});
      } else if (style === 'selection') {
        H.selectionStart().catch(() => {});
      } else {
        // 'light' | 'medium' | 'heavy'
        H.impact({ style: style.toUpperCase() }).catch(() => {});
      }
    } catch {}
  }

  // Convenient shortcuts that callers can pin in code without juggling strings
  const tap     = () => haptic('light');
  const tapBig  = () => haptic('medium');
  const sos     = () => haptic('heavy');
  const success = () => haptic('success');
  const error   = () => haptic('error');

  return { setupStatusBar, hideSplash, haptic, tap, tapBig, sos, success, error };
})();

// Run as early as possible so the user sees the app chrome instead of the
// default white system bars during the first paint.
Visual.setupStatusBar();

// Hide the splash a bit after DOM ready (lets the first paint happen first)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(Visual.hideSplash, 300));
} else {
  setTimeout(Visual.hideSplash, 300);
}

// Safety net : force the splash to hide after 5s no matter what.
// Prevents 'black screen forever' if the normal hide path fails (plugin
// missing on the installed APK, JS error during boot, etc.).
setTimeout(Visual.hideSplash, 5000);
