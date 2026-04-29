// ── GPS sharing module ───────────────────────────────────────────────────────
const GeoModule = (() => {
  let watchId = null;
  let sendInterval = null;
  let lastPosition = null;
  let isPrivate = false;
  let intervalSec = 30;

  // Detect stillness: don't send if moved < 5m since last send
  let lastSentPosition = null;
  const STILL_THRESHOLD_M = 5;
  const STILL_INTERVAL_MULTIPLIER = 3;

  function start(intervalSeconds = 30) {
    intervalSec = intervalSeconds;
    if (watchId) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(
      (pos) => { lastPosition = pos; },
      (err) => console.warn('GPS error:', err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    scheduleSend();
    console.log('[GPS] Sharing started, interval:', intervalSec, 's');
  }

  function stop() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (sendInterval)    { clearTimeout(sendInterval); sendInterval = null; }
    lastPosition = null;
    console.log('[GPS] Sharing stopped');
  }

  function scheduleSend() {
    if (sendInterval) clearTimeout(sendInterval);
    const isStill = lastSentPosition && lastPosition &&
      distanceM(lastSentPosition, lastPosition.coords) < STILL_THRESHOLD_M;
    const delay = isStill
      ? intervalSec * STILL_INTERVAL_MULTIPLIER * 1000
      : intervalSec * 1000;

    sendInterval = setTimeout(async () => {
      await sendPosition();
      if (!isPrivate) scheduleSend();
    }, delay);
  }

  async function sendPosition() {
    if (isPrivate || !lastPosition) return;
    const { latitude, longitude, accuracy, speed } = lastPosition.coords;

    let battery = null;
    try {
      const nav = await navigator.getBattery?.();
      if (nav) battery = Math.round(nav.level * 100);
    } catch {}

    try {
      await API.post('/api/positions', {
        latitude, longitude, accuracy,
        speed: speed ? Math.round(speed * 3.6) : 0,
        battery,
      });
      lastSentPosition = { latitude, longitude };
    } catch (err) {
      console.warn('[GPS] Send error:', err.message);
    }
  }

  function setPrivate(val) {
    isPrivate = val;
    if (val) {
      stop();
    } else {
      start(intervalSec);
    }
  }

  function setInterval_(sec) {
    intervalSec = sec;
    if (!isPrivate) start(sec);
  }

  function getCurrentLatLng() {
    if (!lastPosition) return null;
    return [lastPosition.coords.latitude, lastPosition.coords.longitude];
  }

  return { start, stop, setPrivate, setInterval: setInterval_, getCurrentLatLng };
})();

function distanceM(a, b) {
  const R = 6_371_000;
  const dLat = ((b.latitude  - a.latitude)  * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude  * Math.PI) / 180) *
    Math.cos((b.latitude  * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
