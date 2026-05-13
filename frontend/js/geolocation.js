// ── GPS sharing module ───────────────────────────────────────────────────────
const GeoModule = (() => {
  // Detect Capacitor native context
  const IS_NATIVE = !!(window.Capacitor?.isNativePlatform?.());

  let watchId      = null;
  let sendInterval = null;
  let lastPosition = null;
  let isPrivate    = false;
  let intervalSec  = 30;
  let wakeLock     = null;

  // Capacitor BackgroundGeolocation watcher id
  let bgWatcherId  = null;

  // Speed alert
  let speedLimitKmh      = 110;
  let speedAlertCallback = null;
  let lastSpeedAlertAt   = 0;
  const SPEED_ALERT_COOLDOWN_MS = 120_000;

  // Stillness detection
  let lastSentPosition = null;
  const STILL_THRESHOLD_M       = 5;
  const STILL_INTERVAL_MULT     = 3;

  // Driving mode
  let drivingMode          = false;
  let drivingStopTimer     = null;
  let preDrivingIntervalSec = null;

  // Crash detection
  let crashDetectionEnabled = false;
  let crashSpikeAt          = null;
  let crashMotionHandler    = null;
  const CRASH_SPIKE_MS2     = 25;  // m/s² net acceleration threshold
  const CRASH_STILL_MS2     = 2;   // m/s² — device is still after crash
  const CRASH_WINDOW_MS     = 5000; // 5s to detect stillness after spike

  // Battery saver
  let batterySaverActive    = false;
  const BATTERY_SAVER_ON    = 0.20; // < 20%
  const BATTERY_SAVER_OFF   = 0.25; // > 25%
  const BATTERY_SAVER_SEC   = 120;
  const DRIVING_ON_KMH     = 20;  // speed to enter driving mode
  const DRIVING_OFF_KMH    = 5;   // speed to start exit countdown
  const DRIVING_OFF_DELAY  = 60_000; // 1 min of slow speed to exit

  // ── Start / Stop ─────────────────────────────────────────────────────────────
  function start(intervalSeconds = 30) {
    intervalSec = intervalSeconds;

    if (IS_NATIVE) {
      startNative();
    } else {
      startWeb();
    }

    requestWakeLock();
    scheduleSend();
    console.log('[GPS] Started, interval:', intervalSec, 's', IS_NATIVE ? '(native)' : '(web)');
  }

  function startWeb() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        lastPosition = pos;
        checkSpeedAlert(pos);
        checkDrivingMode(pos.coords.speed != null ? pos.coords.speed * 3.6 : 0);
      },
      (err) => console.warn('[GPS] error:', err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  async function startNative() {
    // Remove previous watcher if any
    if (bgWatcherId !== null) {
      try {
        const BGGeo = window.Capacitor.Plugins.BackgroundGeolocation;
        await BGGeo.removeWatcher({ id: bgWatcherId });
      } catch {}
      bgWatcherId = null;
    }

    try {
      const BGGeo = window.Capacitor.Plugins.BackgroundGeolocation;
      bgWatcherId = await BGGeo.addWatcher(
        {
          backgroundMessage: 'FamilyTracker partage votre position.',
          backgroundTitle:   'FamilyTracker actif',
          requestPermissions: true,
          stale: false,
          distanceFilter: 10,
        },
        (location, error) => {
          if (error) { console.warn('[GPS native] error:', error.code); return; }
          // Normalise to Web Geolocation API shape so existing code works
          const pos = {
            coords: {
              latitude:  location.latitude,
              longitude: location.longitude,
              accuracy:  location.accuracy,
              speed:     location.speed,       // already m/s or null
              altitude:  location.altitude,
            },
            timestamp: location.time,
          };
          lastPosition = pos;
          checkSpeedAlert(pos);
          checkDrivingMode(pos.coords.speed != null ? pos.coords.speed * 3.6 : 0);
        }
      );
      console.log('[GPS native] watcher id:', bgWatcherId);
    } catch (err) {
      console.error('[GPS native] Failed to start, falling back to web:', err);
      startWeb();
    }
  }

  function stop() {
    if (IS_NATIVE && bgWatcherId !== null) {
      try {
        const BGGeo = window.Capacitor.Plugins.BackgroundGeolocation;
        BGGeo.removeWatcher({ id: bgWatcherId });
      } catch {}
      bgWatcherId = null;
    }
    if (watchId != null)   { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (sendInterval)      { clearTimeout(sendInterval); sendInterval = null; }
    if (drivingStopTimer)  { clearTimeout(drivingStopTimer); drivingStopTimer = null; }
    releaseWakeLock();
    lastPosition = null;
    drivingMode  = false;
    console.log('[GPS] Stopped');
  }

  // ── Speed alert ──────────────────────────────────────────────────────────────
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
    speedLimitKmh      = limitKmh;
    speedAlertCallback = callback;
  }

  // ── Driving mode ─────────────────────────────────────────────────────────────
  function checkDrivingMode(speedKmh) {
    if (isPrivate) return;

    if (speedKmh >= DRIVING_ON_KMH) {
      // Cancel any pending exit timer
      if (drivingStopTimer) { clearTimeout(drivingStopTimer); drivingStopTimer = null; }

      if (!drivingMode) {
        drivingMode           = true;
        preDrivingIntervalSec = intervalSec;
        intervalSec           = 10;
        requestWakeLock();
        dispatchDrivingMode(true);
        console.log('[GPS] Driving mode ON');
      }
    } else if (drivingMode && speedKmh < DRIVING_OFF_KMH && !drivingStopTimer) {
      drivingStopTimer = setTimeout(() => {
        drivingMode      = false;
        drivingStopTimer = null;
        if (preDrivingIntervalSec != null) {
          intervalSec           = preDrivingIntervalSec;
          preDrivingIntervalSec = null;
        }
        dispatchDrivingMode(false);
        console.log('[GPS] Driving mode OFF');
      }, DRIVING_OFF_DELAY);
    }
  }

  function isDriving() { return drivingMode; }

  function dispatchDrivingMode(active) {
    document.dispatchEvent(new CustomEvent('driving-mode', { detail: { active } }));
  }

  // ── Wake Lock ────────────────────────────────────────────────────────────────
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        document.addEventListener('visibilitychange', reacquireWakeLock, { once: true });
      });
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

  // ── Position sending ─────────────────────────────────────────────────────────
  function scheduleSend() {
    if (sendInterval) clearTimeout(sendInterval);
    const isStill = lastSentPosition && lastPosition &&
      distanceM(lastSentPosition, lastPosition.coords) < STILL_THRESHOLD_M;
    const delay = (isStill && !drivingMode)
      ? intervalSec * STILL_INTERVAL_MULT * 1000
      : intervalSec * 1000;

    sendInterval = setTimeout(async () => {
      await sendPosition();
      if (!isPrivate) scheduleSend();
    }, delay);
  }

  // Heartbeat : always send a position at least every 10 min so the server
  // doesn't think the member went offline. Below this, skip if barely moved.
  const HEARTBEAT_MS = 10 * 60 * 1000;
  const SKIP_MOVE_M  = 10;
  let lastSentAt = 0;

  async function sendPosition() {
    if (isPrivate || !lastPosition) return;
    const { latitude, longitude, accuracy, speed } = lastPosition.coords;

    // Skip if barely moved AND last send is recent (not driving)
    const moved   = lastSentPosition ? distanceM(lastSentPosition, lastPosition.coords) : Infinity;
    const sinceMs = lastSentAt ? Date.now() - lastSentAt : Infinity;
    if (moved < SKIP_MOVE_M && sinceMs < HEARTBEAT_MS && !drivingMode) {
      return;       // ~80% of POSTs skipped when the user is stationary
    }

    let battery = null;
    try {
      const nav = await navigator.getBattery?.();
      if (nav) {
        battery = Math.round(nav.level * 100);
        // Battery saver: drop to 120s when below 20%, restore above 25%
        if (!drivingMode) {
          if (nav.level < BATTERY_SAVER_ON && !batterySaverActive) {
            batterySaverActive = true;
            intervalSec = BATTERY_SAVER_SEC;
            document.dispatchEvent(new CustomEvent('battery-saver', { detail: { active: true, level: battery } }));
          } else if (nav.level >= BATTERY_SAVER_OFF && batterySaverActive) {
            batterySaverActive = false;
            intervalSec = parseInt(localStorage.getItem('ft_interval')) || 30;
            document.dispatchEvent(new CustomEvent('battery-saver', { detail: { active: false, level: battery } }));
          }
        }
      }
    } catch {}

    try {
      await API.post('/api/positions', {
        latitude, longitude, accuracy,
        speed:   speed != null ? Math.round(speed * 3.6) : 0,
        battery,
      });
      lastSentPosition = { latitude, longitude };
      lastSentAt = Date.now();
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
    if (!isPrivate && !drivingMode) start(sec);
  }

  function getCurrentLatLng() {
    if (!lastPosition) return null;
    return [lastPosition.coords.latitude, lastPosition.coords.longitude];
  }

  function getCurrentSpeed() {
    if (!lastPosition?.coords.speed) return 0;
    return Math.round(lastPosition.coords.speed * 3.6);
  }

  // ── Crash detection ──────────────────────────────────────────────────────────
  function enableCrashDetection(enabled) {
    crashDetectionEnabled = enabled;
    if (!enabled) {
      if (crashMotionHandler) {
        window.removeEventListener('devicemotion', crashMotionHandler);
        crashMotionHandler = null;
      }
      crashSpikeAt = null;
      return;
    }

    if (!window.DeviceMotionEvent) {
      console.warn('[Crash] DeviceMotionEvent not supported');
      return;
    }

    crashMotionHandler = (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const net = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);

      if (!crashSpikeAt && net > CRASH_SPIKE_MS2) {
        crashSpikeAt = Date.now();
        console.log('[Crash] Spike detected:', net.toFixed(1), 'm/s²');
        return;
      }

      if (crashSpikeAt) {
        const elapsed = Date.now() - crashSpikeAt;
        if (elapsed <= CRASH_WINDOW_MS && net < CRASH_STILL_MS2) {
          crashSpikeAt = null;
          console.log('[Crash] Stillness after spike → crash-warning');
          document.dispatchEvent(new CustomEvent('crash-warning'));
        } else if (elapsed > CRASH_WINDOW_MS) {
          crashSpikeAt = null; // window expired, reset
        }
      }
    };

    window.addEventListener('devicemotion', crashMotionHandler);
  }

  function getCurrentAccuracy() {
    return lastPosition?.coords.accuracy ?? null;
  }

  function getStatus() {
    return {
      active:        watchId !== null || bgWatcherId !== null,
      native:        IS_NATIVE,
      intervalSec,
      drivingMode,
      batterySaverActive,
      isPrivate,
      accuracyM:     getCurrentAccuracy(),
      hasWakeLock:   wakeLock !== null,
      lastFixAt:     lastPosition?.timestamp ?? null,
    };
  }

  async function recalibrate() {
    stop();
    // brief pause before re-start to actually reset the watcher
    await new Promise((r) => setTimeout(r, 300));
    start(intervalSec);
  }

  return {
    start, stop, setPrivate,
    setInterval: setInterval_,
    getCurrentLatLng, getCurrentSpeed, getCurrentAccuracy,
    getStatus, recalibrate,
    setSpeedAlert, enableCrashDetection,
    isWakeLockActive, isDriving,
  };
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
