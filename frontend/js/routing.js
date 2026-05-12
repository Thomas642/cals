// ── Routing + geocoding helpers ──────────────────────────────────────────────
// Calls the backend (/api/routing/*) which proxies to OSRM + Nominatim.
const RoutingModule = (() => {

  // ── Real-route ETA (replaces haversine) ───────────────────────────────────
  // Returns { distance_m, duration_s } or null if routing service is down.
  async function computeRoute(fromLat, fromLng, toLat, toLng, { alternatives = false } = {}) {
    try {
      const r = await API.post('/api/routing/route', {
        from: { lat: fromLat, lng: fromLng },
        to:   { lat: toLat,   lng: toLng },
        alternatives,
      });
      return r;
    } catch (err) {
      console.warn('[routing] fallback to haversine —', err.message);
      return null;
    }
  }

  // ── Forward geocoding (address → lat/lng) ─────────────────────────────────
  async function geocode(query) {
    if (!query || query.length < 3) return [];
    try {
      return await API.get(`/api/routing/geocode?q=${encodeURIComponent(query)}`);
    } catch (err) {
      console.warn('[routing] geocode failed:', err.message);
      return [];
    }
  }

  // ── Reverse geocoding (lat/lng → address) ─────────────────────────────────
  async function reverseGeocode(lat, lng) {
    try {
      return await API.get(`/api/routing/reverse?lat=${lat}&lng=${lng}`);
    } catch (err) {
      console.warn('[routing] reverse failed:', err.message);
      return null;
    }
  }

  // ── External navigation (Waze / Google Maps) ──────────────────────────────
  function openInWaze(lat, lng) {
    // Waze deep-link works on Android, iOS and web (falls back to waze.com)
    const url = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
    window.open(url, '_blank', 'noopener');
  }

  function openInGoogleMaps(lat, lng) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    window.open(url, '_blank', 'noopener');
  }

  // Show a picker if the device might have both apps installed; else just
  // delegate to the OS default by opening the geo: URI.
  function openNavigation(lat, lng, label = '') {
    // Build a tiny in-place modal so user can pick between Waze and Maps
    const existing = document.getElementById('navPickerOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'navPickerOverlay';
    overlay.className = 'panel-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';
    overlay.innerHTML = `
      <div style="background:var(--surface,#0f1629);border:1px solid var(--border);border-radius:14px;padding:1.2rem 1.4rem;width:90%;max-width:340px;color:var(--text,#e2e8f0)">
        <h3 style="margin:0 0 .6rem 0;font-size:1rem">Démarrer un trajet</h3>
        ${label ? `<p style="margin:0 0 1rem 0;font-size:.85rem;color:var(--text-muted)">${label}</p>` : ''}
        <button class="btn btn-primary btn-full" id="navPickInApp">📍 Naviguer dans l'app</button>
        <button class="btn btn-ghost btn-full mt-1" id="navPickWaze">🧭 Ouvrir dans Waze</button>
        <button class="btn btn-ghost btn-full mt-1" id="navPickMaps">🗺️ Ouvrir dans Google Maps</button>
        <button class="btn btn-ghost btn-full mt-1" id="navPickCancel">Annuler</button>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('navPickInApp').onclick = () => {
      if (window.NavigationModule) NavigationModule.start(lat, lng, label);
      overlay.remove();
    };
    document.getElementById('navPickWaze').onclick = () => { openInWaze(lat, lng); overlay.remove(); };
    document.getElementById('navPickMaps').onclick = () => { openInGoogleMaps(lat, lng); overlay.remove(); };
    document.getElementById('navPickCancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  return {
    computeRoute,
    geocode,
    reverseGeocode,
    openNavigation,
    openInWaze,
    openInGoogleMaps,
  };
})();
