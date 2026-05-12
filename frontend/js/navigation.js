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
  let destination   = null;        // { lat, lng, name }
  let steps         = [];          // [{ distance_m, duration_s, name, maneuver: {type, modifier, location, exit} }]
  let currentStep   = 0;
  let totalDistanceM = 0;
  let totalDurationS = 0;
  let lastReroutAt  = 0;
  let posWatcher    = null;        // setInterval id

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
    showHUD();
    updateHUD();

    // Poll GPS every 2 seconds to update step + detect off-route
    posWatcher = setInterval(tick, 2000);
  }

  function stop() {
    if (!active && !routeLayer) return;
    active = false;
    if (posWatcher) { clearInterval(posWatcher); posWatcher = null; }
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    altLayers.forEach((l) => map.removeLayer(l));
    altLayers = [];
    if (arrowMarker) { map.removeLayer(arrowMarker); arrowMarker = null; }
    hideHUD();
    destination = null;
    steps = [];
    currentStep = 0;
  }

  function isActive() { return active; }

  // ── Drawing ──────────────────────────────────────────────────────────────
  function drawRoute(data) {
    if (routeLayer) map.removeLayer(routeLayer);
    const coords = data.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    routeLayer = L.polyline(coords, {
      color: '#3b82f6', weight: 6, opacity: 0.85, lineJoin: 'round',
    }).addTo(map);

    // Marker on the next maneuver location
    if (data.steps?.[0]?.maneuver?.location) {
      const [lng, lat] = data.steps[0].maneuver.location;
      if (arrowMarker) map.removeLayer(arrowMarker);
      arrowMarker = L.circleMarker([lat, lng], {
        radius: 6, color: '#fff', fillColor: '#3b82f6', fillOpacity: 1, weight: 2,
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

  // ── HUD (instruction bar at the bottom) ──────────────────────────────────
  function showHUD() {
    let hud = document.getElementById('navHud');
    if (hud) hud.remove();
    hud = document.createElement('div');
    hud.id = 'navHud';
    hud.className = 'nav-hud';
    hud.innerHTML = `
      <div class="nav-hud-icon" id="navHudIcon">⬆️</div>
      <div class="nav-hud-body">
        <div class="nav-hud-instruction" id="navHudInstruction">Démarrage…</div>
        <div class="nav-hud-meta" id="navHudMeta">— · —</div>
      </div>
      <button class="nav-hud-stop" id="navHudStop" title="Arrêter">✕</button>
    `;
    document.body.appendChild(hud);
    document.getElementById('navHudStop').onclick = () => stop();
  }

  function hideHUD() {
    document.getElementById('navHud')?.remove();
  }

  function updateHUD(distToDestOverride = null, arrived = false) {
    const hud = document.getElementById('navHud');
    if (!hud) return;
    const step = steps[currentStep] || {};

    document.getElementById('navHudIcon').textContent = arrived ? '🏁' : maneuverIcon(step);

    let instruction;
    if (arrived) {
      instruction = 'Vous êtes arrivé';
    } else {
      const here = GeoModule.getCurrentLatLng();
      let distM = 0;
      if (here && step.maneuver?.location) {
        distM = haversineKm(here[0], here[1], step.maneuver.location[1], step.maneuver.location[0]) * 1000;
      }
      instruction = `${distM ? `Dans ${formatDistance(distM)} : ` : ''}${translate(step)}`;
    }
    document.getElementById('navHudInstruction').textContent = instruction;

    const here = GeoModule.getCurrentLatLng();
    let remainingM = totalDistanceM;
    let remainingS = totalDurationS;
    if (here && destination) {
      const distRest = haversineKm(here[0], here[1], destination.lat, destination.lng) * 1000;
      remainingM = Math.max(remainingM * 0, distRest);
      // Roughly proportional duration from remaining straight-line vs total straight-line
      remainingS = Math.round(totalDurationS * (distRest / Math.max(1, totalDistanceM)));
    }
    document.getElementById('navHudMeta').textContent =
      `${formatDistance(remainingM)} · ${Math.max(1, Math.round(remainingS / 60))} min`;
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
