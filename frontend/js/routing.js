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
      if (typeof NavigationModule !== 'undefined') {
        NavigationModule.start(lat, lng, label);
      } else {
        console.error('NavigationModule not loaded');
      }
      overlay.remove();
    };
    document.getElementById('navPickWaze').onclick = () => { openInWaze(lat, lng); overlay.remove(); };
    document.getElementById('navPickMaps').onclick = () => { openInGoogleMaps(lat, lng); overlay.remove(); };
    document.getElementById('navPickCancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  // ── Floating search overlay (where do you want to go?) ────────────────────
  function openSearch() {
    document.getElementById('searchOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'searchOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:flex-start;justify-content:center;z-index:9999;padding:1rem';
    overlay.innerHTML = `
      <div style="background:var(--surface,#0f1629);border:1px solid var(--border);border-radius:14px;padding:.9rem 1rem;width:100%;max-width:480px;margin-top:60px;color:var(--text,#e2e8f0)">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.7rem">
          <h3 style="margin:0;font-size:1rem;flex:1">Où aller ?</h3>
          <button id="searchClose" class="btn btn-ghost btn-sm">✕</button>
        </div>
        <input type="text" id="searchInput" placeholder="Adresse, lieu, ville…" autocomplete="off" autofocus
          style="width:100%;padding:.7rem 1rem;background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:.95rem;font-family:inherit">
        <div id="searchResults" style="margin-top:.5rem;max-height:60vh;overflow-y:auto"></div>
      </div>`;
    document.body.appendChild(overlay);

    const input = document.getElementById('searchInput');
    const results = document.getElementById('searchResults');
    document.getElementById('searchClose').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (q.length < 3) { results.innerHTML = ''; return; }
      debounce = setTimeout(async () => {
        const items = await geocode(q);
        if (!items.length) {
          results.innerHTML = '<div style="padding:.6rem;color:var(--text-muted);font-size:.85rem">Aucun résultat</div>';
          return;
        }
        results.innerHTML = items.map((r, i) => `
          <div class="search-result" data-i="${i}" style="padding:.6rem .8rem;border-bottom:1px solid var(--border);cursor:pointer;font-size:.85rem">
            <div style="font-weight:600">${(r.display_name || '').split(',')[0]}</div>
            <div style="color:var(--text-muted);font-size:.78rem">${r.display_name}</div>
          </div>`).join('');
        results.querySelectorAll('.search-result').forEach((el) => {
          el.onclick = () => {
            const r = items[parseInt(el.dataset.i)];
            overlay.remove();
            openNavigation(r.latitude, r.longitude, (r.display_name || '').split(',').slice(0, 2).join(','));
          };
        });
      }, 350);
    });
  }

  return {
    computeRoute,
    geocode,
    reverseGeocode,
    openNavigation,
    openSearch,
    openInWaze,
    openInGoogleMaps,
  };
})();
