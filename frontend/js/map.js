// ── Map module ───────────────────────────────────────────────────────────────
const MapModule = (() => {
  let map, markers = {}, tripLayer = null, zoneCircles = [];
  let pickingZone = false;
  let placeMarkers = {};
  let onLongPressCallback = null;

  const PLACE_ICONS = {
    home: '🏠', work: '💼', school: '🏫', sport: '🏋️', shop: '🛒', star: '⭐',
  };

  function init() {
    map = L.map('map', {
      center: [46.5, 2.5],
      zoom: 6,
      zoomControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
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
    const initials = member.name ? member.name.slice(0, 2).toUpperCase() : '?';
    const avatarContent = member.avatar_url
      ? `<img src="${member.avatar_url}" alt="">`
      : initials;

    const html = `
      <div class="member-marker">
        <div class="marker-avatar" style="border-color:${member.color};color:${member.color}">
          ${avatarContent}
        </div>
        <div class="marker-name" style="color:${member.color}">${member.name}</div>
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
    const age = m.recorded_at
      ? timeAgo(new Date(m.recorded_at))
      : 'inconnu';
    const bat = m.battery != null ? `🔋 ${m.battery}%` : '';
    const spd = m.speed ? `⚡ ${Math.round(m.speed)} km/h` : '';
    return `<b>${m.name}</b><br>
      ${m.status ? `<em>${m.status}</em><br>` : ''}
      ${bat} ${spd}<br>
      <small>Mis à jour ${age}</small>`;
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
    marker.bindPopup(
      `<strong>${emoji} ${place.name}</strong><br>
      <button class="btn btn-danger btn-sm" style="margin-top:.5rem;width:100%" onclick="window._deletePlaceCallback && window._deletePlaceCallback('${place.id}')">Supprimer</button>`,
      { maxWidth: 180 }
    );
    placeMarkers[place.id] = marker;
  }

  function removePlace(id) {
    if (placeMarkers[id]) {
      map.removeLayer(placeMarkers[id]);
      delete placeMarkers[id];
    }
  }

  return { init, updateMember, removeMember, focusMember, focusAll, showTrip, replayTrip, clearTrip, renderZones, setPickingZone, getMap, setOnLongPress, renderPlaces, addPlace, removePlace };
})();

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(date) {
  const secs = Math.floor((Date.now() - date) / 1000);
  if (secs < 60)  return `il y a ${secs}s`;
  if (secs < 3600) return `il y a ${Math.floor(secs / 60)}min`;
  if (secs < 86400) return `il y a ${Math.floor(secs / 3600)}h`;
  return `il y a ${Math.floor(secs / 86400)}j`;
}
