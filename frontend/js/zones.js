// ════════════════════════════════════════════════════════════════════════════
//  FamilyTracker — Zones panel (lazy-loaded on first navZones click)
//
//  Loaded by app.js when the user first opens the Zones tab. Defines the
//  full panel UI : create/edit/delete zones, address autocomplete, notify
//  toggle, route-to-zone shortcut.
//
//  Dependencies (defined in app.js, accessed as globals here):
//    API, zones (array), MapModule, RoutingModule, currentUser,
//    showToast, setActiveNav, loadZones
// ════════════════════════════════════════════════════════════════════════════

function setupZones() {
  const overlay = document.getElementById('zonesOverlay');

  document.getElementById('navZones').addEventListener('click', () => {
    renderZoneList();
    overlay.classList.remove('hidden');
    try { MapModule.setPickingZone(true); } catch {}
    setActiveNav('navZones');
  });

  document.getElementById('closeZones').addEventListener('click', () => {
    overlay.classList.add('hidden');
    MapModule.setPickingZone(false);
    setActiveNav('navMap');
  });

  document.getElementById('createZone').addEventListener('click', async () => {
    const name    = document.getElementById('zoneName').value.trim();
    const address = document.getElementById('zoneAddress').value.trim();
    const lat     = parseFloat(document.getElementById('zoneLat').value);
    const lon     = parseFloat(document.getElementById('zoneLon').value);
    const radius  = parseInt(document.getElementById('zoneRadius').value);

    if (!name || isNaN(lat) || isNaN(lon) || isNaN(radius)) {
      showToast('Erreur', 'Tous les champs sont requis');
      return;
    }

    try {
      await API.post('/api/zones', { name, latitude: lat, longitude: lon, radius, address });
      await loadZones();
      renderZoneList();
      document.getElementById('zoneName').value = '';
      document.getElementById('zoneAddress').value = '';
      showToast('Zone créée', name);
    } catch (err) {
      showToast('Erreur', err.message);
    }
  });

  // ── Address autocomplete on the zone form ────────────────────────────────
  const addrInput = document.getElementById('zoneAddress');
  const addrResults = document.getElementById('zoneAddressResults');
  let addrDebounce = null;
  let lastGeocodedAddress = '';

  addrInput?.addEventListener('input', () => {
    clearTimeout(addrDebounce);
    const q = addrInput.value.trim();
    if (q.length < 3) { addrResults.classList.add('hidden'); return; }
    if (q === lastGeocodedAddress) return;
    addrDebounce = setTimeout(async () => {
      const results = await RoutingModule.geocode(q);
      lastGeocodedAddress = q;
      if (!results.length) { addrResults.classList.add('hidden'); return; }
      addrResults.innerHTML = results.map((r, i) => `
        <div class="addr-item" data-i="${i}">
          <span class="addr-item-type">${r.type || ''}</span>${r.display_name}
        </div>`).join('');
      addrResults.classList.remove('hidden');
      addrResults.querySelectorAll('.addr-item').forEach((el) => {
        el.onclick = () => {
          const r = results[parseInt(el.dataset.i)];
          document.getElementById('zoneLat').value = r.latitude.toFixed(6);
          document.getElementById('zoneLon').value = r.longitude.toFixed(6);
          addrInput.value = r.display_name;
          addrResults.classList.add('hidden');
          if (window.MapModule) MapModule.getMap().setView([r.latitude, r.longitude], 15);
        };
      });
    }, 400);
  });

  // Click outside → close results
  document.addEventListener('click', (e) => {
    if (!addrInput?.contains(e.target) && !addrResults?.contains(e.target)) {
      addrResults?.classList.add('hidden');
    }
  });

  // Expose reverse-geocode to map.js so it auto-fills when picking on map
  window.reverseGeocodeForZone = async (lat, lng) => {
    const r = await RoutingModule.reverseGeocode(lat, lng);
    if (r?.display_name) {
      addrInput.value = r.display_name;
      lastGeocodedAddress = r.display_name;
    }
  };
}

function renderZoneList() {
  const container = document.getElementById('zoneList');
  if (!zones.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🚧</div>
        <div class="empty-state-title">Aucune zone définie</div>
        <div class="empty-state-body">Créez une zone (Maison, Travail…) en cliquant sur la carte ou en tapant une adresse ci-dessous.</div>
      </div>`;
    return;
  }
  container.innerHTML = zones.map((z) => {
    const notifyAll  = !z.notify_members || z.notify_members.length === 0;
    const iNotified  = notifyAll || z.notify_members.includes(currentUser?.id);
    const bellIcon   = iNotified ? '🔔' : '🔕';
    const bellTitle  = iNotified ? 'Notifications actives — cliquer pour désactiver' : 'Notifications désactivées — cliquer pour activer';
    const addr = z.address ? `<div class="text-muted" style="font-size:.75rem;margin-top:.15rem">📍 ${z.address}</div>` : '';
    return `
    <div class="zone-row" data-zone-id="${z.id}">
      <div style="min-width:0;flex:1">
        <strong>${z.name}</strong>
        <div class="text-muted">${z.radius} m${notifyAll ? '' : ` · ${z.notify_members.length} destinataire(s)`}</div>
        ${addr}
      </div>
      <div style="display:flex;gap:.4rem;align-items:center">
        <button class="btn btn-ghost btn-sm btn-zone-nav" title="Démarrer un trajet" data-lat="${z.latitude}" data-lng="${z.longitude}" data-name="${z.name}">🧭</button>
        <button class="btn btn-ghost btn-sm btn-zone-bell" title="${bellTitle}" data-zone-id="${z.id}">${bellIcon}</button>
        <button class="btn btn-danger btn-sm btn-zone-del" data-id="${z.id}">✕</button>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.btn-zone-nav').forEach((btn) => {
    btn.addEventListener('click', () => {
      RoutingModule.openNavigation(
        parseFloat(btn.dataset.lat),
        parseFloat(btn.dataset.lng),
        btn.dataset.name
      );
    });
  });

  container.querySelectorAll('.btn-zone-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await API.delete(`/api/zones/${btn.dataset.id}`);
        await loadZones();
        renderZoneList();
      } catch (err) {
        showToast('Erreur', err.message);
      }
    });
  });

  container.querySelectorAll('.btn-zone-bell').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const updated = await API.patch(`/api/zones/${btn.dataset.zoneId}/notify-toggle`, {});
        const idx = zones.findIndex((z) => z.id === updated.id);
        if (idx >= 0) zones[idx].notify_members = updated.notify_members;
        renderZoneList();
        const on = !updated.notify_members.length || updated.notify_members.includes(currentUser?.id);
        showToast(on ? '🔔 Notifié(e)' : '🔕 Notifications désactivées', `Zone : ${updated.name}`);
      } catch (err) {
        showToast('Erreur', err.message);
      }
    });
  });
}
