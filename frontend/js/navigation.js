// ── In-app turn-by-turn navigation ───────────────────────────────────────────
// Uses OSRM steps + the user's live GPS position to drive a bottom instruction
// bar, draws the route polyline on the Leaflet map, and reroutes when the
// driver goes off-track.
const NavigationModule = (() => {

  let active        = false;
  let map           = null;
  let routeLayer    = null;
  let altLayers     = [];
  let arrowMarker   = null;
  let userArrow     = null;        // first-person directional arrow (Leaflet marker with rotated divIcon)
  let destination   = null;        // { lat, lng, name }
  let steps         = [];          // [{ distance_m, duration_s, name, maneuver: {type, modifier, location, exit} }]
  let currentStep   = 0;
  let totalDistanceM = 0;
  let totalDurationS = 0;
  let lastReroutAt  = 0;
  let posWatcher    = null;        // setInterval id
  let followMode    = true;        // auto-pan to user; disabled when user manually drags
  let lastHeading   = 0;
  let lastUserPos   = null;
  let mapDragHandler = null;
  let rotateMap     = true;        // true → bearing follows user heading (Waze-style)
  let voiceEnabled  = localStorage.getItem('ft_nav_voice') !== 'off';
  let lastSpokenStep = -1;
  let lastSpokenAt   = 0;

  // ── French translation of OSRM maneuvers ─────────────────────────────────
  const MODIFIER_FR = {
    'left':         'à gauche',
    'slight left':  'légèrement à gauche',
    'sharp left':   'fortement à gauche',
    'right':        'à droite',
    'slight right': 'légèrement à droite',
    'sharp right':  'fortement à droite',
    'straight':     'tout droit',
    'uturn':        'demi-tour',
  };

  function translate(step) {
    const t = step.maneuver?.type || '';
    const m = step.maneuver?.modifier || '';
    const name = step.name || '';
    const onStreet = name ? ` sur ${name}` : '';

    switch (t) {
      case 'depart':       return `Démarrez${onStreet}`;
      case 'arrive':       return `Vous êtes arrivé${name ? ' à ' + name : ''}`;
      case 'turn':         return `Tournez ${MODIFIER_FR[m] || m}${onStreet}`;
      case 'continue':     return `Continuez ${MODIFIER_FR[m] || 'tout droit'}${onStreet}`;
      case 'new name':     return `Continuez${onStreet}`;
      case 'merge':        return `Insérez-vous ${MODIFIER_FR[m] || ''}${onStreet}`.trim();
      case 'on ramp':      return `Prenez la bretelle d'accès ${MODIFIER_FR[m] || ''}`.trim();
      case 'off ramp':     return `Prenez la sortie ${MODIFIER_FR[m] || ''}${onStreet}`.trim();
      case 'fork':         return `À la fourche, ${MODIFIER_FR[m] || 'tout droit'}${onStreet}`;
      case 'end of road':  return `Au bout de la route, tournez ${MODIFIER_FR[m] || ''}${onStreet}`.trim();
      case 'roundabout':
      case 'rotary': {
        const ex = step.maneuver?.exit;
        const ord = ex ? `${ex}${ex === 1 ? 're' : 'e'}` : 'prochaine';
        return `Au rond-point, prenez la ${ord} sortie${onStreet}`;
      }
      case 'exit roundabout':
      case 'exit rotary':  return `Sortez du rond-point${onStreet}`;
      default:             return `Continuez${onStreet}`;
    }
  }

  // Icon for the current maneuver (uses simple emoji to avoid SVG bundle bloat)
  function maneuverIcon(step) {
    const t = step.maneuver?.type || '';
    const m = step.maneuver?.modifier || '';
    if (t === 'arrive') return '🏁';
    if (t === 'depart') return '🚗';
    if (t === 'roundabout' || t === 'rotary') return '🔄';
    if (m.includes('right')) return '↪️';
    if (m.includes('left'))  return '↩️';
    if (m === 'uturn') return '🔃';
    return '⬆️';
  }

  // ── Public API ───────────────────────────────────────────────────────────
  async function start(destLat, destLng, destName = '') {
    if (active) stop();

    const here = GeoModule.getCurrentLatLng();
    if (!here) {
      showToast('Erreur', 'Position GPS inconnue, impossible de démarrer la navigation.');
      return;
    }

    destination = { lat: destLat, lng: destLng, name: destName };
    showToast('Calcul de l\'itinéraire…', destName || `${destLat.toFixed(4)}, ${destLng.toFixed(4)}`);

    const data = await RoutingModule.computeRoute(here[0], here[1], destLat, destLng, {
      alternatives: true, steps: true,
    });
    if (!data) {
      showToast('Erreur', 'Service de routage indisponible.');
      return;
    }

    map = MapModule.getMap();
    drawRoute(data);
    showAlternatives(data.alternatives || []);

    steps = data.steps || [];
    currentStep = 0;
    totalDistanceM = data.distance_m;
    totalDurationS = data.duration_s;

    active = true;
    followMode = true;
    showHUD();
    updateHUD();
    enableFollowMode();

    // Poll GPS every 2 seconds to update step + detect off-route
    posWatcher = setInterval(tick, 2000);
  }

  // ── First-person / follow mode ────────────────────────────────────────────
  function enableFollowMode() {
    if (!map) return;
    // Disable follow if user drags the map manually
    mapDragHandler = () => {
      if (!followMode) return;
      followMode = false;
      showRecenterButton();
    };
    map.on('dragstart', mapDragHandler);
    map.on('zoomstart', (e) => {
      // Only treat user-initiated zooms as "exited follow"
      if (e.target?._zoomAnimated && e?.target?._animatingZoom === false) return;
    });
    centerOnUser(true);
  }

  function disableFollowMode() {
    if (mapDragHandler && map) map.off('dragstart', mapDragHandler);
    mapDragHandler = null;
    document.getElementById('navRecenter')?.remove();
    if (userArrow) { map.removeLayer(userArrow); userArrow = null; }
  }

  function showRecenterButton() {
    if (document.getElementById('navRecenter')) return;
    const btn = document.createElement('button');
    btn.id = 'navRecenter';
    btn.className = 'nav-recenter';
    btn.innerHTML = '🎯 Re-centrer';
    btn.onclick = () => {
      followMode = true;
      btn.remove();
      centerOnUser(true);
    };
    document.body.appendChild(btn);
  }

  function centerOnUser(animate = false) {
    const here = GeoModule.getCurrentLatLng();
    if (!here || !map) return;
    map.setView(here, 17, { animate });
    updateUserArrow(here);
    applyBearing();
  }

  // Rotate the map so the user's heading is always "up" on screen (Waze-style).
  // Requires the leaflet-rotate plugin (map.setBearing). Falls back to no-op.
  function applyBearing() {
    if (!rotateMap || !map || typeof map.setBearing !== 'function') return;
    // Smooth out by snapping to nearest 5°
    const target = Math.round(-lastHeading / 5) * 5;
    map.setBearing(target);
  }

  function updateUserArrow(latlng) {
    if (!map) return;
    // Heading: prefer GPS heading, fallback to bearing between consecutive positions
    let heading = lastHeading;
    if (lastUserPos) {
      const computed = bearing(lastUserPos[0], lastUserPos[1], latlng[0], latlng[1]);
      if (Number.isFinite(computed)) heading = computed;
    }
    lastUserPos = latlng;
    lastHeading = heading;

    // If the map itself is rotated to follow heading, the arrow stays
    // upright (always pointing "screen-up"). Otherwise we rotate it manually.
    const arrowDeg = (rotateMap && map && typeof map.setBearing === 'function') ? 0 : heading;
    const html = `<div class="nav-arrow" style="transform:rotate(${arrowDeg}deg)">▲</div>`;
    if (!userArrow) {
      userArrow = L.marker(latlng, {
        icon: L.divIcon({ html, className: 'nav-arrow-wrap', iconSize: [44, 44], iconAnchor: [22, 22] }),
        zIndexOffset: 3000,
        interactive: false,
      }).addTo(map);
    } else {
      userArrow.setLatLng(latlng);
      userArrow.setIcon(L.divIcon({ html, className: 'nav-arrow-wrap', iconSize: [44, 44], iconAnchor: [22, 22] }));
    }
  }

  // Bearing (degrees, 0 = North, clockwise) between two lat/lng pairs
  function bearing(lat1, lng1, lat2, lng2) {
    const toRad = (d) => d * Math.PI / 180;
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δλ = toRad(lng2 - lng1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function stop() {
    if (!active && !routeLayer) return;
    active = false;
    if (posWatcher) { clearInterval(posWatcher); posWatcher = null; }
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    altLayers.forEach((l) => map.removeLayer(l));
    altLayers = [];
    if (arrowMarker) { map.removeLayer(arrowMarker); arrowMarker = null; }
    disableFollowMode();
    hideHUD();
    // Reset map orientation when leaving navigation
    if (map && typeof map.setBearing === 'function') map.setBearing(0);
    // Stop any ongoing TTS
    if (window.speechSynthesis) speechSynthesis.cancel();
    destination = null;
    steps = [];
    currentStep = 0;
    lastUserPos = null;
    lastSpokenStep = -1;
  }

  function isActive() { return active; }

  // ── Drawing ──────────────────────────────────────────────────────────────
  function drawRoute(data) {
    if (routeLayer) map.removeLayer(routeLayer);
    const coords = data.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    // Waze-style thick purple route, with subtle outer halo for readability
    routeLayer = L.layerGroup([
      L.polyline(coords, { color: '#1e1b4b', weight: 14, opacity: 0.55, lineJoin: 'round', lineCap: 'round' }),
      L.polyline(coords, { color: '#7c3aed', weight: 10, opacity: 1.0, lineJoin: 'round', lineCap: 'round' }),
    ]).addTo(map);
    // Expose getBounds on the group so fitBounds still works
    routeLayer.getBounds = () => L.latLngBounds(coords);
    routeLayer.getLatLngs = () => coords.map(([lat, lng]) => ({ lat, lng }));

    // Marker on the next maneuver location
    if (data.steps?.[0]?.maneuver?.location) {
      const [lng, lat] = data.steps[0].maneuver.location;
      if (arrowMarker) map.removeLayer(arrowMarker);
      arrowMarker = L.circleMarker([lat, lng], {
        radius: 7, color: '#fff', fillColor: '#7c3aed', fillOpacity: 1, weight: 3,
      }).addTo(map);
    }

    map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });
  }

  function showAlternatives(alts) {
    altLayers.forEach((l) => map.removeLayer(l));
    altLayers = alts.map((alt, i) => {
      const coords = alt.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const line = L.polyline(coords, {
        color: '#94a3b8', weight: 5, opacity: 0.55, dashArray: '6 6',
      }).addTo(map);
      line.on('click', () => {
        // Promote this alternative to main
        const newSteps = alt.steps || [];
        if (routeLayer) map.removeLayer(routeLayer);
        routeLayer = L.polyline(coords, {
          color: '#3b82f6', weight: 6, opacity: 0.85, lineJoin: 'round',
        }).addTo(map);
        steps = newSteps;
        currentStep = 0;
        totalDistanceM = alt.distance_m;
        totalDurationS = alt.duration_s;
        updateHUD();
        showToast('Itinéraire changé', `${Math.round(alt.duration_s/60)} min · ${(alt.distance_m/1000).toFixed(1)} km`);
        altLayers.forEach((l) => map.removeLayer(l));
        altLayers = [];
      });
      return line;
    });
  }

  // ── GPS tick: advance steps & detect off-route ───────────────────────────
  function tick() {
    if (!active) return;
    const here = GeoModule.getCurrentLatLng();
    if (!here) return;

    // Update directional arrow & re-center if follow mode is on
    updateUserArrow(here);
    if (followMode) {
      map.panTo(here, { animate: true, duration: 0.5 });
      applyBearing();
    }

    // Voice : announce upcoming maneuver once when within 250m and not yet
    // spoken for this step
    const step = steps[currentStep];
    if (step?.maneuver?.location) {
      const distToM = haversineKm(here[0], here[1], step.maneuver.location[1], step.maneuver.location[0]) * 1000;
      if (currentStep !== lastSpokenStep && distToM < 250 && Date.now() - lastSpokenAt > 4000) {
        speak(`Dans ${formatDistance(distToM)}, ${translate(step).toLowerCase()}`);
        lastSpokenStep = currentStep;
        lastSpokenAt = Date.now();
      }
    }

    // Advance to next step when we get close to the current maneuver location
    while (currentStep < steps.length - 1) {
      const loc = steps[currentStep].maneuver.location;
      if (!loc) { currentStep++; continue; }
      const distToManeuver = haversineKm(here[0], here[1], loc[1], loc[0]) * 1000;
      if (distToManeuver < 25) { currentStep++; } else { break; }
    }

    // Arrival?
    const distToDest = haversineKm(here[0], here[1], destination.lat, destination.lng) * 1000;
    if (distToDest < 40) {
      updateHUD(distToDest, true);
      showToast('🏁 Arrivé', destination.name || 'Destination atteinte');
      speak(`Vous êtes arrivé${destination.name ? ' à ' + destination.name : ''}.`);
      stop();
      return;
    }

    // Off-route detection: > 60m from the route polyline
    if (routeLayer) {
      const offMeters = distanceToPolylineM(here, routeLayer.getLatLngs());
      if (offMeters > 60 && Date.now() - lastReroutAt > 15_000) {
        lastReroutAt = Date.now();
        showToast('Recalcul…', 'Hors itinéraire, nouveau calcul en cours.');
        reroute();
        return;
      }
    }

    updateHUD();
  }

  async function reroute() {
    const here = GeoModule.getCurrentLatLng();
    if (!here || !destination) return;
    const data = await RoutingModule.computeRoute(here[0], here[1], destination.lat, destination.lng, {
      alternatives: false, steps: true,
    });
    if (!data) return;
    drawRoute(data);
    steps = data.steps || [];
    currentStep = 0;
    totalDistanceM = data.distance_m;
    totalDurationS = data.duration_s;
    updateHUD();
  }

  // ── HUD (Waze-style: big top banner + bottom arrival panel + speedo) ──────
  function showHUD() {
    document.getElementById('navHud')?.remove();
    document.getElementById('navHudBottom')?.remove();
    document.getElementById('navSpeedo')?.remove();

    // Top banner: big maneuver icon + distance + instruction + voice/stop
    const hud = document.createElement('div');
    hud.id = 'navHud';
    hud.className = 'nav-hud';
    hud.innerHTML = `
      <div class="nav-hud-icon" id="navHudIcon">⬆️</div>
      <div class="nav-hud-body">
        <div class="nav-hud-dist" id="navHudDist">—</div>
        <div class="nav-hud-instruction" id="navHudInstruction">Démarrage…</div>
      </div>
      <div class="nav-hud-actions">
        <button class="nav-hud-btn" id="navHudVoice" title="${voiceEnabled ? 'Couper la voix' : 'Activer la voix'}">${voiceEnabled ? '🔊' : '🔇'}</button>
        <button class="nav-hud-btn" id="navHudStop" title="Arrêter">✕</button>
      </div>`;
    document.body.appendChild(hud);
    document.getElementById('navHudStop').onclick = () => stop();
    document.getElementById('navHudVoice').onclick = (e) => {
      voiceEnabled = !voiceEnabled;
      localStorage.setItem('ft_nav_voice', voiceEnabled ? 'on' : 'off');
      e.currentTarget.textContent = voiceEnabled ? '🔊' : '🔇';
      e.currentTarget.title = voiceEnabled ? 'Couper la voix' : 'Activer la voix';
      if (!voiceEnabled && window.speechSynthesis) speechSynthesis.cancel();
    };

    // Bottom panel: arrival time · remaining duration · remaining distance
    const bottom = document.createElement('div');
    bottom.id = 'navHudBottom';
    bottom.className = 'nav-hud-bottom';
    bottom.innerHTML = `
      <div class="nav-hud-bottom-col">
        <div class="nav-hud-bottom-val" id="navArrivalTime">—</div>
        <div class="nav-hud-bottom-label">Arrivée</div>
      </div>
      <div class="nav-hud-bottom-col primary">
        <div class="nav-hud-bottom-val" id="navRemainingTime">—</div>
        <div class="nav-hud-bottom-label">Durée</div>
      </div>
      <div class="nav-hud-bottom-col">
        <div class="nav-hud-bottom-val" id="navRemainingDist">—</div>
        <div class="nav-hud-bottom-label">Distance</div>
      </div>`;
    document.body.appendChild(bottom);

    // Speedometer bottom-left
    const speedo = document.createElement('div');
    speedo.id = 'navSpeedo';
    speedo.className = 'nav-speedo';
    speedo.innerHTML = `
      <div class="nav-speedo-val" id="navSpeedoVal">0</div>
      <div class="nav-speedo-unit">km/h</div>`;
    document.body.appendChild(speedo);
  }

  // ── Text-to-speech (Web Speech API) ───────────────────────────────────────
  function speak(text) {
    if (!voiceEnabled || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();           // drop any previous utterance
      const u = new SpeechSynthesisUtterance(text);
      u.lang   = 'fr-FR';
      u.rate   = 1.05;
      u.volume = 1.0;
      speechSynthesis.speak(u);
    } catch (err) {
      console.warn('[nav] TTS failed:', err.message);
    }
  }

  function hideHUD() {
    document.getElementById('navHud')?.remove();
    document.getElementById('navHudBottom')?.remove();
    document.getElementById('navSpeedo')?.remove();
  }

  function updateHUD(distToDestOverride = null, arrived = false) {
    const hud = document.getElementById('navHud');
    if (!hud) return;
    const step = steps[currentStep] || {};
    const here = GeoModule.getCurrentLatLng();

    // — Top banner —
    document.getElementById('navHudIcon').textContent = arrived ? '🏁' : maneuverIcon(step);

    let distToManeuverM = 0;
    if (here && step.maneuver?.location) {
      distToManeuverM = haversineKm(here[0], here[1], step.maneuver.location[1], step.maneuver.location[0]) * 1000;
    }
    document.getElementById('navHudDist').textContent =
      arrived ? '🏁' : (distToManeuverM ? formatDistance(distToManeuverM) : '—');
    document.getElementById('navHudInstruction').textContent =
      arrived ? 'Vous êtes arrivé' : translate(step);

    // — Bottom arrival panel —
    let remainingM = totalDistanceM;
    let remainingS = totalDurationS;
    if (here && destination) {
      const distRest = haversineKm(here[0], here[1], destination.lat, destination.lng) * 1000;
      remainingM = distRest;
      remainingS = Math.round(totalDurationS * (distRest / Math.max(1, totalDistanceM)));
    }
    const arrivalDate = new Date(Date.now() + remainingS * 1000);
    const arrivalTime = arrivalDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const durMin = Math.max(1, Math.round(remainingS / 60));
    const durStr = durMin >= 60 ? `${Math.floor(durMin / 60)}h ${durMin % 60}` : `${durMin} min`;
    const arrivalEl = document.getElementById('navArrivalTime');
    if (arrivalEl) arrivalEl.textContent = arrivalTime;
    const remTimeEl = document.getElementById('navRemainingTime');
    if (remTimeEl) remTimeEl.textContent = durStr;
    const remDistEl = document.getElementById('navRemainingDist');
    if (remDistEl) remDistEl.textContent = formatDistance(remainingM);

    // — Speedometer (current GPS speed, km/h) —
    const speedKmh = GeoModule.getCurrentSpeed?.() || 0;
    const speedoEl = document.getElementById('navSpeedoVal');
    if (speedoEl) speedoEl.textContent = Math.round(speedKmh);
  }

  // ── Utilities ────────────────────────────────────────────────────────────
  function formatDistance(m) {
    if (m < 1000) return `${Math.round(m / 10) * 10} m`;
    return `${(m / 1000).toFixed(1)} km`;
  }

  // Approx point→polyline distance in meters (good enough for off-route check)
  function distanceToPolylineM(point, latlngs) {
    let min = Infinity;
    for (let i = 0; i < latlngs.length - 1; i++) {
      const d = pointToSegmentM(point, latlngs[i], latlngs[i + 1]);
      if (d < min) min = d;
    }
    return min;
  }

  function pointToSegmentM(p, a, b) {
    // Convert to local x/y in meters using equirectangular approximation
    const toXY = (ll) => [
      ll.lng !== undefined ? ll.lng : ll[1],
      ll.lat !== undefined ? ll.lat : ll[0],
    ];
    const [plng, plat] = toXY({ lat: p[0], lng: p[1] });
    const [alng, alat] = toXY(a);
    const [blng, blat] = toXY(b);
    const meanLat = (plat + alat + blat) / 3 * Math.PI / 180;
    const mX = (lng) => lng * 111320 * Math.cos(meanLat);
    const mY = (lat) => lat * 110540;
    const px = mX(plng), py = mY(plat);
    const ax = mX(alng), ay = mY(alat);
    const bx = mX(blng), by = mY(blat);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  return { start, stop, isActive };
})();
