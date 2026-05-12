// ── In-app APK update check ──────────────────────────────────────────────────
// On native (Capacitor APK) only :
//   1. Read the installed app version via @capacitor/app
//   2. Fetch /download/version.json (built by scripts/build-android.sh)
//   3. If the server's version is newer → show a non-blocking banner with
//      a "Télécharger la mise à jour" button that opens the APK URL.
//      Android then prompts the user to install over the existing app
//      (no data loss).
const UpdateCheck = (() => {

  const VERSION_URL = '/download/version.json';
  const APK_URL     = '/download/FamilyTracker.apk';
  const DISMISS_KEY = 'ft_update_dismissed_v';

  // Naive semver comparator: returns 1 if a > b, -1 if a < b, 0 if equal.
  // Accepts "1.2.3" or "2026.05.12-1430".
  function cmp(a, b) {
    const parse = (v) => String(v).split(/[.\-]/).map((n) => parseInt(n, 10) || 0);
    const A = parse(a), B = parse(b);
    const len = Math.max(A.length, B.length);
    for (let i = 0; i < len; i++) {
      const x = A[i] || 0, y = B[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  async function getInstalledVersion() {
    const App = window.Capacitor?.Plugins?.App;
    if (!App) return null;
    try {
      const info = await App.getInfo();   // { name, id, build, version }
      return info?.version || null;
    } catch (err) {
      console.warn('[UpdateCheck] App.getInfo failed:', err.message);
      return null;
    }
  }

  async function fetchServerVersion() {
    try {
      const r = await fetch(VERSION_URL, { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();        // { version, built_at, notes }
    } catch {
      return null;
    }
  }

  async function check() {
    // Web context : no APK installed, nothing to update
    if (!window.Capacitor?.isNativePlatform?.()) return;

    const installed = await getInstalledVersion();
    const server    = await fetchServerVersion();
    if (!installed || !server?.version) return;

    if (cmp(server.version, installed) <= 0) return;                  // already up-to-date or older

    // Respect previous dismissal of THIS exact server version
    if (localStorage.getItem(DISMISS_KEY) === server.version) return;

    showBanner(installed, server);
  }

  function showBanner(installedVersion, server) {
    if (document.getElementById('updateBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'updateBanner';
    banner.className = 'update-banner';
    banner.innerHTML = `
      <div class="update-banner-icon">⬆️</div>
      <div class="update-banner-body">
        <strong>Mise à jour disponible</strong>
        <div class="update-banner-meta">
          v${installedVersion} → <strong>v${server.version}</strong>${server.notes ? ` · ${escapeHtml(server.notes)}` : ''}
        </div>
      </div>
      <button class="update-banner-btn" id="updateDl">Télécharger</button>
      <button class="update-banner-close" id="updateDismiss" title="Plus tard">✕</button>
    `;
    document.body.appendChild(banner);

    document.getElementById('updateDl').onclick = () => downloadApk();
    document.getElementById('updateDismiss').onclick = () => {
      localStorage.setItem(DISMISS_KEY, server.version);
      banner.remove();
    };
  }

  async function downloadApk() {
    // Prefer the Browser plugin (opens in an external system browser,
    // which triggers Android's APK installer correctly).
    const Browser = window.Capacitor?.Plugins?.Browser;
    if (Browser) {
      try { await Browser.open({ url: location.origin + APK_URL }); return; }
      catch (e) { console.warn('[UpdateCheck] Browser.open failed:', e.message); }
    }
    // Fallback : window.open (Capacitor v6 intercepts external URLs)
    window.open(location.origin + APK_URL, '_system', 'noopener');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  }

  return { check };
})();

// Kick off the check shortly after page load so it doesn't block first paint
setTimeout(() => UpdateCheck.check(), 3000);
