// ── Map module ───────────────────────────────────────────────────────────────
const MapModule = (() => {
  let map, markers = {}, tripLayer = null, zoneCircles = [];
  let pickingZone = false;
  let placeMarkers = {};
  let onLongPressCallback = null;
  let tileLayer = null;
  let heatLayer = null;
  let currentTheme = localStorage.getItem('ft_map_theme') || 'dark';

  const TILES = {
    dark:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  };

  const PLACE_ICONS = {
    home: '🏠', work: '💼', school: '🏫', sport: '🏋️', shop: '🛒', star: '⭐',
  };

  function init() {
    map = L.map('map', {
      center: [46.5, 2.5],
      zoom: 6,
      zoomControl: false,
      // leaflet-rotate plugin enables map.setBearing / map.getBearing
      rotate: true,         // requires leaflet-rotate plugin; option is silently ignored if absent
      rotateControl: false,
      bearing: 0,
      touchRotate: false,    // the navigation module drives bearing, not finger gestures
    });

    tileLayer = L.tileLayer(TILES[currentTheme], {
      attribution: '© <a href="https://openstreetmap.org">OSM</a> © <a href="https://carto.com">CARTO</a>',
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map);

    L.control.zoom({ position: 'topleft' }).addTo(map);

    map.on('click', onMapClick);

    // Right-click (desktop) → add place
    map.on('contextmenu', (e) => {
      L.DomEvent.preventDefault(e);
      if (onLongPressCallback) onLongPressCallback(e.latlng.lat, e.latlng.lng);
    });

    // Long-press (mobile touch)
    let lpTimer = null;
    let lpMoved = false;
    map.on('touchstart', (e) => {
      lpMoved = false;
      const latlng = e.latlng;
      lpTimer = setTimeout(() => {
        if (!lpMoved && onLongPressCallback) onLongPressCallback(latlng.lat, latlng.lng);
      }, 700);
    });
    map.on('touchmove',  () => { lpMoved = true; clearTimeout(lpTimer); });
    map.on('touchend',   () => clearTimeout(lpTimer));

    return map;
  }

  function onMapClick(e) {
    if (!pickingZone) return;
    const { lat, lng } = e.latlng;
    document.getElementById('zoneLat').value = lat.toFixed(6);
    document.getElementById('zoneLon').value = lng.toFixed(6);
    showToast('📍 Position sélectionnée', `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    // Reverse-geocode to fill the address field (best-effort)
    if (window.reverseGeocodeForZone) window.reverseGeocodeForZone(lat, lng);
  }

  function setPickingZone(val) {
    pickingZone = val;
    map.getContainer().style.cursor = val ? 'crosshair' : '';
  }

  // ── Member markers ──────────────────────────────────────────────────────────
  function updateMember(member) {
    if (!member.latitude || !member.longitude) return;

    const latlng = [member.latitude, member.longitude];

    if (markers[member.id]) {
      markers[member.id].setLatLng(latlng);
      markers[member.id].setIcon(createIcon(member));
    } else {
      markers[member.id] = L.marker(latlng, {
        icon: createIcon(member),
        zIndexOffset: 1000,
      }).addTo(map);
    }

    markers[member.id].bindPopup(buildPopup(member));
  }

  function createIcon(member) {
    const ageMin = member.recorded_at ? (Date.now() - new Date(member.recorded_at)) / 60000 : Infinity;
    const isOffline = ageMin > 10;
    const initials = member.name ? member.name.slice(0, 2).toUpperCase() : '?';
    const avatarContent = member.avatar_url
      ? `<img src="${member.avatar_url}" alt="">`
      : initials;
    const offlineClass = isOffline ? ' offline' : '';

    const html = `
      <div class="member-marker${offlineClass}">
        <div class="marker-avatar" style="border-color:${member.color};color:${member.color}">
          ${avatarContent}
        </div>
        <div class="marker-name" style="color:${member.color}">${member.name}${isOffline ? '<span class="marker-offline-badge">⚫</span>' : ''}</div>
        <div class="marker-tail" style="border-top-color:${member.color}"></div>
      </div>`;

    return L.divIcon({
      html,
      className: '',
      iconSize: [60, 70],
      iconAnchor: [30, 70],
      popupAnchor: [0, -70],
    });
  }

  function buildPopup(m) {
    const age = m.recorded_at ? timeAgo(new Date(m.recorded_at)) : 'inconnu';
    const bat = m.battery != null ? `🔋 ${m.battery}%` : '';
    const spd = m.speed ? `⚡ ${Math.round(m.speed)} km/h` : '';
    const safeName = (m.name || '').replace(/'/g, "\\'");
    return `<b>${m.name}</b><br>
      ${m.status ? `<em>${m.status}</em><br>` : ''}
      ${bat} ${spd}<br>
      <small>Mis à jour ${age}</small>
      <button class="btn btn-primary btn-sm btn-full" style="margin-top:.5rem"
        onclick="RoutingModule.openNavigation(${m.latitude},${m.longitude},'${safeName}')">🧭 Y aller</button>`;
  }

  function removeMember(id) {
    if (markers[id]) {
      map.removeLayer(markers[id]);
      delete markers[id];
    }
  }

  function focusMember(id) {
    if (markers[id]) {
      map.setView(markers[id].getLatLng(), 16, { animate: true });
      markers[id].openPopup();
    }
  }

  function focusAll() {
    const pts = Object.values(markers).map((m) => m.getLatLng());
    if (pts.length === 0) return;
    if (pts.length === 1) { map.setView(pts[0], 14); return; }
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
  }

  // ── Trip replay ─────────────────────────────────────────────────────────────
  function showTrip(points, color = '#3b82f6') {
    clearTrip();
    if (!points.length) return;
    const latlngs = points.map((p) => [p.latitude, p.longitude]);
    tripLayer = L.polyline(latlngs, { color, weight: 4, opacity: .8 }).addTo(map);
    map.fitBounds(tripLayer.getBounds(), { padding: [30, 30] });
  }

  function clearTrip() {
    if (tripLayer) { map.removeLayer(tripLayer); tripLayer = null; }
  }

  // Animated replay
  function replayTrip(points, color = '#3b82f6') {
    clearTrip();
    if (!points.length) return;
    tripLayer = L.polyline([], { color, weight: 4, opacity: .8 }).addTo(map);
    const latlngs = points.map((p) => [p.latitude, p.longitude]);
    let i = 0;
    map.setView(latlngs[0], 14);
    const step = () => {
      if (i >= latlngs.length) return;
      tripLayer.addLatLng(latlngs[i++]);
      if (map.getBounds().contains(tripLayer.getBounds()) === false) {
        map.panTo(latlngs[i - 1]);
      }
      setTimeout(step, 40);
    };
    step();
  }

  // ── Zones ───────────────────────────────────────────────────────────────────
  function renderZones(zones) {
    zoneCircles.forEach((c) => map.removeLayer(c));
    zoneCircles = [];
    zones.filter((z) => z.is_active).forEach((z) => {
      const c = L.circle([z.latitude, z.longitude], {
        radius: z.radius,
        color: '#3b82f6',
        weight: 2,
        fillColor: '#3b82f6',
        fillOpacity: .1,
      }).addTo(map);
      c.bindTooltip(z.name, { permanent: true, direction: 'center', className: 'zone-label' });
      const addrLine = z.address ? `<div style="font-size:.75rem;color:var(--text-muted);margin:.3rem 0">📍 ${z.address}</div>` : '';
      c.bindPopup(
        `<strong>${z.name}</strong><div style="font-size:.78rem;color:var(--text-muted)">Zone · ${z.radius} m</div>${addrLine}
         <button class="btn btn-primary btn-sm btn-full" style="margin-top:.4rem"
           onclick="RoutingModule.openNavigation(${z.latitude},${z.longitude},'${(z.name || '').replace(/'/g, "\\'")}')">🧭 Y aller</button>`,
        { maxWidth: 240 }
      );
      zoneCircles.push(c);
    });
  }

  function getMap() { return map; }

  // ── Places ──────────────────────────────────────────────────────────────────
  function setOnLongPress(callback) {
    onLongPressCallback = callback;
  }

  function renderPlaces(places) {
    Object.values(placeMarkers).forEach((m) => map.removeLayer(m));
    placeMarkers = {};
    places.forEach(addPlace);
  }

  function addPlace(place) {
    const emoji = PLACE_ICONS[place.icon] || '📍';
    const icon = L.divIcon({
      html: `<div class="place-marker"><span class="place-emoji">${emoji}</span><div class="place-label">${place.name}</div></div>`,
      className: '',
      iconSize: [60, 52],
      iconAnchor: [30, 42],
      popupAnchor: [0, -42],
    });
    const marker = L.marker([place.latitude, place.longitude], { icon, zIndexOffset: 500 }).addTo(map);
    const notesHtml = place.notes
      ? `<div style="font-size:.78rem;color:var(--text-muted);margin:.3rem 0;font-style:italic">${place.notes}</div>`
      : '';
    marker.bindPopup(
      `<strong>${emoji} ${place.name}</strong>${notesHtml}
      <button class="btn btn-primary btn-sm btn-full" style="margin-top:.4rem"
        onclick="RoutingModule.openNavigation(${place.latitude},${place.longitude},'${(place.name || '').replace(/'/g, "\\'")}')">🧭 Y aller</button>
      <div style="display:flex;gap:.3rem;margin-top:.4rem">
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="window._editPlaceNotesCallback && window._editPlaceNotesCallback('${place.id}','${place.name}')">✏️</button>
        <button class="btn btn-danger btn-sm" style="flex:1" onclick="window._deletePlaceCallback && window._deletePlaceCallback('${place.id}')">✕</button>
      </div>`,
      { maxWidth: 220 }
    );
    placeMarkers[place.id] = marker;
  }

  function removePlace(id) {
    if (placeMarkers[id]) {
      map.removeLayer(placeMarkers[id]);
      delete placeMarkers[id];
    }
  }

  // ── Heatmap ─────────────────────────────────────────────────────────────────
  function showHeatmap(points) {
    hideHeatmap();
    if (!window.L || !L.heatLayer) {
      console.warn('[Map] Leaflet.heat not loaded');
      return;
    }
    heatLayer = L.heatLayer(points, {
      radius: 20,
      blur: 25,
      maxZoom: 17,
      gradient: { 0.2: '#3b82f6', 0.5: '#f59e0b', 0.8: '#ef4444' },
    }).addTo(map);
  }

  function hideHeatmap() {
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  }

  function isHeatmapVisible() { return heatLayer !== null; }

  function setTheme(theme) {
    if (!TILES[theme]) return;
    currentTheme = theme;
    localStorage.setItem('ft_map_theme', theme);
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(TILES[theme], {
      attribution: '© <a href="https://openstreetmap.org">OSM</a> © <a href="https://carto.com">CARTO</a>',
      maxZoom: 19, subdomains: 'abcd',
    }).addTo(map);
    tileLayer.bringToBack();
  }

  function getTheme() { return currentTheme; }

  return {
    init, updateMember, removeMember, focusMember, focusAll,
    showTrip, replayTrip, clearTrip,
    renderZones, setPickingZone, getMap,
    setOnLongPress, renderPlaces, addPlace, removePlace,
    setTheme, getTheme,
    showHeatmap, hideHeatmap, isHeatmapVisible,
  };
})();

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(date) {
  const secs = Math.floor((Date.now() - date) / 1000);
  if (secs < 60)  return `il y a ${secs}s`;
  if (secs < 3600) return `il y a ${Math.floor(secs / 60)}min`;
  if (secs < 86400) return `il y a ${Math.floor(secs / 3600)}h`;
  return `il y a ${Math.floor(secs / 86400)}j`;
}
