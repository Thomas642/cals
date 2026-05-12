// ── GPS sharing module ───────────────────────────────────────────────────────
const GeoModule = (() => {
  let watchId = null;
  let sendInterval = null;
  let lastPosition = null;
  let isPrivate = false;
  let intervalSec = 30;
  let wakeLock = null;

  // Speed alert
  let speedLimitKmh = 110;
  let speedAlertCallback = null;
  let lastSpeedAlertAt = 0;
  const SPEED_ALERT_COOLDOWN_MS = 120_000; // 2 min between alerts

  // Stillness detection
  let lastSentPosition = null;
  const STILL_THRESHOLD_M = 5;
  const STILL_INTERVAL_MULTIPLIER = 3;

  function start(intervalSeconds = 30) {
    intervalSec = intervalSeconds;
    if (watchId) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        lastPosition = pos;
        checkSpeedAlert(pos);
      },
      (err) => console.warn('[GPS] error:', err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    requestWakeLock();
    scheduleSend();
    console.log('[GPS] Started, interval:', intervalSec, 's');
  }

  function stop() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (sendInterval)    { clearTimeout(sendInterval); sendInterval = null; }
    releaseWakeLock();
    lastPosition = null;
    console.log('[GPS] Stopped');
  }

  // ── Speed alert ─────────────────────────────────────────────────────────────
  function checkSpeedAlert(pos) {
    if (!speedAlertCallback || !speedLimitKmh) return;
    const kmh = pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : 0;
    const now = Date.now();
    if (kmh > speedLimitKmh && now - lastSpeedAlertAt > SPEED_ALERT_COOLDOWN_MS) {
      lastSpeedAlertAt = now;
      speedAlertCallback(kmh, pos.coords.latitude, pos.coords.longitude);
    }
  }

  function setSpeedAlert(limitKmh, callback) {
    speedLimitKmh = limitKmh;
    speedAlertCallback = callback;
  }

  // ── Wake Lock (keeps screen on for background tracking) ─────────────────────
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        // Re-acquire when tab becomes visible again
        document.addEventListener('visibilitychange', reacquireWakeLock, { once: true });
      });
      console.log('[WakeLock] Screen kept active');
      dispatchTrackingStatus(true);
    } catch (err) {
      console.warn('[WakeLock]', err.message);
      dispatchTrackingStatus(false);
    }
  }

  async function reacquireWakeLock() {
    if (document.visibilityState === 'visible' && watchId && !isPrivate) {
      await requestWakeLock();
    }
  }

  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release(); wakeLock = null; }
    dispatchTrackingStatus(false);
  }

  function dispatchTrackingStatus(active) {
    document.dispatchEvent(new CustomEvent('tracking-status', { detail: { active } }));
  }

  function isWakeLockActive() { return wakeLock !== null; }

  // ── Position sending ────────────────────────────────────────────────────────
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
        speed: speed != null ? Math.round(speed * 3.6) : 0,
        battery,
      });
      lastSentPosition = { latitude, longitude };
    } catch (err) {
      console.warn('[GPS] Send error:', err.message);
    }
  }

  function setPrivate(val) {
    isPrivate = val;
    if (val) { stop(); } else { start(intervalSec); }
  }

  function setInterval_(sec) {
    intervalSec = sec;
    if (!isPrivate) start(sec);
  }

  function getCurrentLatLng() {
    if (!lastPosition) return null;
    return [lastPosition.coords.latitude, lastPosition.coords.longitude];
  }

  return { start, stop, setPrivate, setInterval: setInterval_, getCurrentLatLng, setSpeedAlert, isWakeLockActive };
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
