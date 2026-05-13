// ── Bootstrap ────────────────────────────────────────────────────────────────
(async () => {
  try {
    await loadCurrentUser();
    MapModule.init();

    if (currentUser.role === 'admin') {
      document.getElementById('navAdmin').classList.remove('hidden');
    }

    const savedInterval   = parseInt(localStorage.getItem('ft_interval'))    || 30;
    const savedSpeedLimit = parseInt(localStorage.getItem('ft_speed_limit')) || 110;
    document.getElementById('gpsInterval').value  = savedInterval;
    document.getElementById('speedLimit').value   = savedSpeedLimit;

    try {
      GeoModule.start(savedInterval);
      GeoModule.setSpeedAlert(savedSpeedLimit, onSpeedAlert);
    } catch (e) { console.warn('[GPS]', e.message); }

    // Tracking indicator (Wake Lock status)
    document.addEventListener('tracking-status', (e) => {
      const dot = document.getElementById('trackingDot');
      if (dot) dot.classList.toggle('active', e.detail.active);
    });

    // Warn when app goes to background
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        showToast('⚠️ Suivi en arrière-plan', 'Gardez l\'app ouverte pour continuer le trajet', 'warning');
      }
    });

    // Battery saver notifications
    document.addEventListener('battery-saver', (e) => {
      if (e.detail.active) {
        showToast(`🔋 Mode économie batterie`, `GPS toutes les 2 min (batterie : ${e.detail.level}%)`, 'warning');
      } else {
        showToast(`🔋 Batterie rechargée`, 'Intervalle GPS normal rétabli', 'ok');
      }
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.warn);
    }

    try { await refreshPositions(); } catch (e) { console.warn('[positions]', e.message); }
    try { await loadZones(); } catch (e) { console.warn('[zones]', e.message); }
    if (typeof loadPlaces === 'function') {
      try { await loadPlaces(); } catch (e) { console.warn('[places]', e.message); }
    }

    // Fallback polling : ne s'exécute QUE si Socket.io est déconnecté ET
    // que l'onglet/app est au premier plan. Évite ~10 calls API/min inutiles
    // quand le temps réel marche (cas normal).
    setInterval(() => {
      if (document.hidden) return;
      if (socket?.connected) return;
      refreshPositions().catch(() => {});
    }, 10_000);

  } catch (e) {
    console.error('[bootstrap init]', e);
  }

  // Setup UI — runs unconditionally even if init above partially failed
  for (const [name, fn] of [
    ['SOS',           setupSOS],
    ['OkButton',      setupOkButton],
    ['QuickMessages', setupQuickMessages],
    ['Privacy',       setupPrivacy],
    ['Profile',       setupProfile],
    ['History',       setupHistory],
    ['Zones',         setupZones],
    ['Places',        typeof setupPlaces === 'function' ? setupPlaces : null],
    ['Navigation',    setupNavigation],
    ['Admin',         setupAdmin],
    ['Locate',        setupLocate],
    ['Search',        setupSearch],
    ['GoHome',        setupGoHome],
    ['ShareTrip',     setupShareTrip],
    ['GpsDiag',       setupGpsDiagnostic],
    ['Socket',        setupSocket],
    ['Install',       setupInstall],
    ['Eta',           setupEta],
    ['DrivingMode',   setupDrivingMode],
    ['Schedule',      setupSchedule],
    ['CrashDetect',   setupCrashDetection],
    ['Heatmap',       setupHeatmap],
    ['SafeReturn',    setupSafeReturn],
    ['Checkin',       setupCheckin],
  ]) {
    if (!fn) continue;
    try { fn(); } catch (e) { console.warn(`[setup${name}]`, e.message); }
  }
})();

// ── Speed alert ───────────────────────────────────────────────────────────────
async function onSpeedAlert(speedKmh, lat, lon) {
  showToast(`⚠️ Vitesse : ${speedKmh} km/h`, 'Excès de vitesse détecté', 'warning');
  try {
    await API.post('/api/notify/speed-alert', { speed: speedKmh, latitude: lat, longitude: lon });
  } catch {}
}

// ── Notification badge state ──────────────────────────────────────────────────
const unread = { members: 0, zones: 0, admin: 0, chat: 0 };

function incBadge(key) {
  unread[key] = (unread[key] || 0) + 1;
  const el = document.getElementById(`badge${key.charAt(0).toUpperCase() + key.slice(1)}`);
  if (el) { el.textContent = unread[key] > 9 ? '9+' : unread[key]; el.classList.remove('hidden'); }
}

function clearBadge(key) {
  unread[key] = 0;
  const el = document.getElementById(`badge${key.charAt(0).toUpperCase() + key.slice(1)}`);
  if (el) el.classList.add('hidden');
}

// ── Realtime via WebSocket ────────────────────────────────────────────────────
let socket;

function setupSocket() {
  // In Capacitor the page has no origin, so io() must connect to the explicit server URL.
  const socketUrl = (window.Capacitor?.isNativePlatform?.())
    ? 'https://famille.gameone-val.com'
    : undefined;
  socket = socketUrl
    ? io(socketUrl, { auth: { token: localStorage.getItem('ft_token') } })
    : io({ auth: { token: localStorage.getItem('ft_token') } });

  socket.on('position_update', (data) => {
    MapModule.updateMember(data);
    updateMemberCard(data);
  });

  socket.on('sos', (data) => {
    if (data.member?.id !== currentUser?.id) {
      showToast(`🆘 SOS — ${data.member.name}`, `Signal de détresse !`, 'sos');
      if (data.latitude) MapModule.getMap().setView([data.latitude, data.longitude], 16);
      showSosAlert(data);
      incBadge('admin');
    }
  });

  socket.on('ok_signal', (data) => {
    if (data.member?.id !== currentUser?.id) {
      showToast(`✅ ${data.member.name} est OK`, 'Signal de sécurité reçu', 'ok');
      incBadge('members');
    }
  });

  socket.on('quick_message', (data) => {
    if (data.member?.id !== currentUser?.id) {
      showToast(`💬 ${data.member.name}`, data.text, 'message');
      incBadge('members');
    }
  });

  socket.on('geofence_enter', (data) => {
    showToast(`📍 ${data.member.name} est arrivé(e)`, `Zone : ${data.zone.name}`);
    incBadge('zones');
  });

  socket.on('geofence_exit', (data) => {
    showToast(`📍 ${data.member.name} a quitté`, `Zone : ${data.zone.name}`);
    incBadge('zones');
  });

  socket.on('battery', (data) => {
    showToast(`🔋 Batterie faible`, `${data.member.name} — batterie critique`, 'warning');
    incBadge('members');
  });

  socket.on('member_offline', (data) => {
    if (data?.member) showToast(`⚠️ ${data.member.name} est déconnecté(e)`, '');
  });

  socket.on('speed_alert', (data) => {
    if (data?.member?.id === currentUser?.id) return;
    showToast(`⚠️ ${data.member.name} — ${data.speed} km/h`, 'Excès de vitesse détecté', 'warning');
    incBadge('members');
  });

  socket.on('chat_message', (msg) => {
    if (msg.user_id === currentUser?.id) return; // already appended locally
    appendChatMessage(msg);
    scrollChatToBottom(true);
    const chatOverlay = document.getElementById('chatOverlay');
    if (chatOverlay?.classList.contains('hidden')) {
      incBadge('chat');
      showToast(`💬 ${msg.name}`, msg.text.slice(0, 60), 'message');
    }
  });

  socket.on('chat_delete', ({ id }) => {
    document.querySelector(`[data-msg-id="${id}"]`)?.remove();
  });

  socket.on('status_update', (data) => {
    if (memberData[data.user_id]) {
      memberData[data.user_id].status = data.status;
      renderMemberList();
    }
  });

  socket.on('connect_error', (err) => {
    console.warn('[WS] Connect error:', err.message);
  });
}

// ── Positions ─────────────────────────────────────────────────────────────────
let memberData = {};

async function refreshPositions() {
  try {
    const positions = await API.get('/api/positions');
    positions.forEach((m) => {
      memberData[m.id] = m;
      MapModule.updateMember(m);
    });
    renderMemberList();
  } catch (err) {
    console.warn('[positions]', err.message);
  }
}

function renderMemberList() {
  const list = document.getElementById('memberList');
  list.innerHTML = '';

  Object.values(memberData).forEach((m) => {
    const card = document.createElement('div');
    card.className = 'member-card';
    card.dataset.id = m.id;

    const initials = m.name ? m.name.slice(0, 2).toUpperCase() : '?';
    const avatarContent = m.avatar_url
      ? `<img src="${m.avatar_url}" alt="${m.name}">`
      : initials;

    const ageSec = m.recorded_at ? (Date.now() - new Date(m.recorded_at)) / 1000 : Infinity;
    const dotClass = ageSec < 120 ? 'member-online-dot' : ageSec < 600 ? 'member-online-dot away' : 'member-online-dot offline';

    const bat = m.battery != null ? m.battery : null;
    const batBarClass = bat != null && bat < 20 ? 'battery-bar-inner low' : bat != null && bat < 40 ? 'battery-bar-inner med' : 'battery-bar-inner';
    const batteryHtml = bat != null ? `
      <span class="battery-wrap">
        <span class="battery-bar-outer"><span class="${batBarClass}" style="width:${bat}%"></span></span>
        <span class="battery-pct">${bat}%</span>
      </span>` : '';

    // ETA to home zone if member is moving (real route via OSRM, fallback to haversine)
    let etaHtml = '';
    if (m.speed > 5 && m.latitude && m.longitude) {
      const homeZone = zones.find((z) => z.name.toLowerCase().includes('maison') || z.name.toLowerCase().includes('home'));
      if (homeZone) {
        const distKm = haversineKm(m.latitude, m.longitude, homeZone.latitude, homeZone.longitude);
        if (distKm > 0.2) {
          const etaId = `eta-${m.id}`;
          // Cache lookup: bucket by ~100m position so we don't re-query OSRM
          // on every minor position update
          const cacheKey = `${m.id}|${homeZone.id}|${m.latitude.toFixed(3)},${m.longitude.toFixed(3)}`;
          const cached = _etaCache.get(cacheKey);
          if (cached && Date.now() - cached.at < 60_000) {
            etaHtml = `<span style="color:var(--primary-l)">🏠 ${cached.min} min</span>`;
          } else {
            // Synchronous fallback estimate, refined async by OSRM
            const etaMin = Math.max(1, Math.round((distKm / m.speed) * 60 * 1.4));
            etaHtml = `<span id="${etaId}" style="color:var(--primary-l)">🏠 ~${etaMin} min</span>`;
            RoutingModule.computeRoute(m.latitude, m.longitude, homeZone.latitude, homeZone.longitude)
              .then((r) => {
                if (!r) return;
                const min = Math.max(1, Math.round(r.duration_s / 60));
                _etaCache.set(cacheKey, { at: Date.now(), min });
                const el = document.getElementById(etaId);
                if (el) el.textContent = `🏠 ${min} min`;
              });
          }
        }
      }
    }

    card.innerHTML = `
      <div class="member-avatar-wrap">
        <div class="member-avatar" style="background:${m.color}">${avatarContent}</div>
        <span class="${dotClass}"></span>
      </div>
      <div class="member-info">
        <div class="member-name">${m.name}</div>
        <div class="member-meta">
          ${batteryHtml}
          ${m.recorded_at ? `<span>${timeAgo(new Date(m.recorded_at))}</span>` : ''}
          ${etaHtml}
        </div>
        ${m.status ? `<div style="font-size:.75rem;color:var(--text-muted);margin-top:.15rem">${m.status}</div>` : ''}
      </div>`;

    card.addEventListener('click', () => MapModule.focusMember(m.id));
    list.appendChild(card);
  });
}

// ETA cache: avoids hammering OSRM on every position update (60s TTL).
const _etaCache = new Map();

// When the page is hidden (screen off, app in background), Socket.io keeps
// pushing events but we don't need to spend CPU on UI rendering.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    // Came back to foreground — force a single refresh so the UI catches up
    refreshPositions().catch(() => {});
  }
});

// Throttle full list re-renders to at most once per second to avoid DOM
// churn when many position updates arrive via Socket.io.
let _renderMemberListPending = false;
let _renderMemberListLast = 0;
function scheduleRenderMemberList() {
  const now = Date.now();
  const sinceLast = now - _renderMemberListLast;
  if (sinceLast >= 1000) {
    _renderMemberListLast = now;
    renderMemberList();
  } else if (!_renderMemberListPending) {
    _renderMemberListPending = true;
    setTimeout(() => {
      _renderMemberListPending = false;
      _renderMemberListLast = Date.now();
      renderMemberList();
    }, 1000 - sinceLast);
  }
}

function updateMemberCard(m) {
  memberData[m.id] = { ...memberData[m.id], ...m };
  scheduleRenderMemberList();
}

// ── SOS ───────────────────────────────────────────────────────────────────────
function setupSOS() {
  const btn = document.getElementById('sosBtn');
  let holdTimer = null;

  const startHold = () => {
    btn.classList.add('holding');
    Visual.tap();   // light tap when the hold starts
    holdTimer = setTimeout(async () => {
      btn.classList.remove('holding');
      Visual.sos(); // heavy vibration when SOS actually fires
      const latlng = GeoModule.getCurrentLatLng();
      try {
        const body = latlng ? { latitude: latlng[0], longitude: latlng[1] } : {};
        await API.post('/api/notify/sos', body);
        showToast('🆘 SOS envoyé', 'Tous les membres ont été alertés', 'sos');
      } catch (err) {
        Visual.error();
        showToast('Erreur SOS', err.message);
      }
    }, 3000);
  };

  const stopHold = () => {
    btn.classList.remove('holding');
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  };

  btn.addEventListener('mousedown',  startHold);
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); startHold(); }, { passive: false });
  btn.addEventListener('mouseup',    stopHold);
  btn.addEventListener('touchend',   stopHold);
  btn.addEventListener('mouseleave', stopHold);
}

function showSosAlert(data) {
  const overlay = document.getElementById('sosAlertOverlay');
  if (!overlay) return;
  document.getElementById('sosAlertName').textContent = data.member?.name || 'Un membre';
  overlay.classList.remove('hidden');

  document.getElementById('sosAlertLocate').onclick = () => {
    overlay.classList.add('hidden');
    if (data.latitude) MapModule.getMap().setView([data.latitude, data.longitude], 16);
  };
  document.getElementById('sosAlertClose').onclick = () => {
    overlay.classList.add('hidden');
  };
}

// ── Je suis OK button ─────────────────────────────────────────────────────────
function setupOkButton() {
  const btn = document.getElementById('okBtn');
  let cooldown = false;

  btn.addEventListener('click', async () => {
    if (cooldown) { showToast('⏳ Patientez', 'Signal déjà envoyé récemment'); return; }
    Visual.tap();
    try {
      await API.post('/api/notify/ok', {});
      Visual.success();
      showToast('✅ Signal envoyé', 'La famille a été notifiée', 'ok');
      btn.classList.add('sent');
      cooldown = true;
      setTimeout(() => { cooldown = false; btn.classList.remove('sent'); }, 30_000);
    } catch (err) {
      Visual.error();
      showToast('Erreur', err.message);
    }
  });
}

// ── Messages rapides ───────────────────────────────────────────────────────────
function setupQuickMessages() {
  const overlay = document.getElementById('msgOverlay');
  const input   = document.getElementById('customMsgInput');

  document.getElementById('msgBtn').addEventListener('click', () => {
    overlay.classList.remove('hidden');
    setTimeout(() => input.focus(), 150);
  });

  document.getElementById('closeMsg').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });

  document.querySelectorAll('.quick-msg-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await sendQuickMessage(btn.dataset.msg);
      overlay.classList.add('hidden');
    });
  });

  document.getElementById('sendCustomMsg').addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) return;
    await sendQuickMessage(text);
    input.value = '';
    overlay.classList.add('hidden');
  });

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const text = input.value.trim();
      if (!text) return;
      await sendQuickMessage(text);
      input.value = '';
      overlay.classList.add('hidden');
    }
  });
}

async function sendQuickMessage(text) {
  try {
    await API.post('/api/notify/message', { text });
    showToast(`💬 Message envoyé`, text, 'message');
  } catch (err) {
    showToast('Erreur', err.message);
  }
}

// ── Privacy toggle ─────────────────────────────────────────────────────────────
function setupPrivacy() {
  const btn   = document.getElementById('btnPrivacy');
  const label = document.getElementById('privacyLabel');
  let isPrivate = false;

  btn.addEventListener('click', () => {
    isPrivate = !isPrivate;
    GeoModule.setPrivate(isPrivate);
    label.textContent = isPrivate ? 'Privé' : 'Partager';
    btn.style.color = isPrivate ? 'var(--warning)' : '';
    showToast(isPrivate ? '🔒 Mode privé activé' : '📡 Partage repris', '');
  });
}

// ── Search destination ─────────────────────────────────────────────────────────
function setupSearch() {
  document.getElementById('searchBtn')?.addEventListener('click', () => {
    if (typeof RoutingModule !== 'undefined') RoutingModule.openSearch();
  });
}

// ── "Je rentre" — share ETA-to-home to family chat ────────────────────────────
function setupGoHome() {
  document.getElementById('goHomeBtn')?.addEventListener('click', async () => {
    const home = zones.find((z) =>
      z.name.toLowerCase().includes('maison') || z.name.toLowerCase().includes('home')
    );
    if (!home) {
      showToast('Pas de zone "Maison"', 'Créez d\'abord une zone nommée Maison ou Home');
      return;
    }
    const here = GeoModule.getCurrentLatLng();
    if (!here) {
      showToast('GPS inconnu', 'Position non disponible — réessayez dans quelques secondes');
      return;
    }
    showToast('🏡 Calcul ETA…', 'Trajet vers la maison');
    const route = await RoutingModule.computeRoute(here[0], here[1], home.latitude, home.longitude);
    const min = route ? Math.max(1, Math.round(route.duration_s / 60))
                      : Math.max(1, Math.round(haversineKm(here[0], here[1], home.latitude, home.longitude) / 50 * 60));
    const distKm = route ? (route.distance_m / 1000).toFixed(1)
                         : haversineKm(here[0], here[1], home.latitude, home.longitude).toFixed(1);
    try {
      await API.post('/api/chat', { text: `🏡 Je rentre — arrivée estimée à ${home.name} dans ~${min} min (${distKm} km)` });
      showToast('Message envoyé', `ETA ${min} min partagée à la famille`);
    } catch (err) {
      showToast('Erreur', err.message);
    }
  });
}

// ── Quick share: generate a temporary public tracking link in 1 click ─────────
function setupShareTrip() {
  document.getElementById('shareTripBtn')?.addEventListener('click', async () => {
    try {
      const { token, expires_in } = await API.post('/api/share', { hours: 2, label: 'Trajet en cours' });
      const url = `${location.origin}/share.html?token=${token}`;
      showShareModal(url, expires_in);
    } catch (err) {
      showToast('Erreur', err.message);
    }
  });
}

function showShareModal(url, expiresIn) {
  document.getElementById('shareTripOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'shareTripOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem';
  overlay.innerHTML = `
    <div style="background:var(--surface,#0f1629);border:1px solid var(--border);border-radius:14px;padding:1.2rem 1.4rem;width:100%;max-width:380px;color:var(--text,#e2e8f0)">
      <h3 style="margin:0 0 .5rem 0;font-size:1rem">📡 Trajet partagé</h3>
      <p style="margin:0 0 .8rem 0;font-size:.82rem;color:var(--text-muted)">Lien valable ${expiresIn || '2h'}. Le destinataire pourra suivre votre position en direct sans compte.</p>
      <input type="text" readonly value="${url}" id="shareUrl"
        style="width:100%;padding:.55rem .7rem;background:var(--surface2);border:1.5px solid var(--border);border-radius:8px;color:var(--text);font-size:.78rem;font-family:monospace;margin-bottom:.6rem">
      <button class="btn btn-primary btn-full" id="shareCopy">📋 Copier le lien</button>
      <button class="btn btn-ghost btn-full mt-1" id="shareWebshare">📤 Partager…</button>
      <button class="btn btn-ghost btn-full mt-1" id="shareClose">Fermer</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('shareCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(url); showToast('Copié !', 'Lien dans le presse-papier'); }
    catch { document.getElementById('shareUrl').select(); document.execCommand('copy'); }
  };
  document.getElementById('shareWebshare').onclick = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Mon trajet en cours', text: 'Suis-moi en direct :', url }); } catch {}
    } else {
      showToast('Indisponible', 'Web Share API non supportée — utilisez Copier');
    }
  };
  document.getElementById('shareClose').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ── GPS diagnostic widget (in profile panel) ──────────────────────────────────
let _gpsDiagTimer = null;

function setupGpsDiagnostic() {
  // Inject the diagnostic block at the top of the Profile panel if not already there
  const profileSheet = document.querySelector('#profileOverlay .panel-sheet');
  if (!profileSheet || document.getElementById('gpsDiag')) return;
  const block = document.createElement('div');
  block.id = 'gpsDiag';
  block.style.cssText = 'background:var(--surface2);border-radius:10px;padding:.7rem .85rem;margin-bottom:1rem;font-size:.82rem';
  block.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem">
      <strong>📡 Diagnostic GPS</strong>
      <button class="btn btn-ghost btn-sm" id="gpsRecalibrate" style="font-size:.72rem">Re-calibrer</button>
    </div>
    <div id="gpsDiagBody" style="color:var(--text-muted);line-height:1.5"></div>`;
  const title = profileSheet.querySelector('.panel-title');
  title?.after(block);
  document.getElementById('gpsRecalibrate').onclick = async () => {
    showToast('🔄 Recalibrage GPS', 'Redémarrage du suivi…');
    await GeoModule.recalibrate();
    setTimeout(refreshGpsDiag, 1500);
  };

  // Only refresh while the profile panel is actually open — saves a tick/5s
  // when the user isn't looking at it.
  const overlay = document.getElementById('profileOverlay');
  const startTimer = () => {
    if (_gpsDiagTimer) return;
    refreshGpsDiag();
    _gpsDiagTimer = setInterval(refreshGpsDiag, 5000);
  };
  const stopTimer = () => {
    if (_gpsDiagTimer) { clearInterval(_gpsDiagTimer); _gpsDiagTimer = null; }
  };
  // Observe panel open/close via attribute (hidden class added/removed)
  new MutationObserver(() => {
    overlay.classList.contains('hidden') ? stopTimer() : startTimer();
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  // Initial state
  if (!overlay.classList.contains('hidden')) startTimer();
}

function refreshGpsDiag() {
  const body = document.getElementById('gpsDiagBody');
  if (!body) return;
  const s = GeoModule.getStatus();
  const acc = s.accuracyM != null ? `${Math.round(s.accuracyM)} m` : '—';
  const accColor = s.accuracyM == null ? 'var(--text-muted)'
    : s.accuracyM < 30 ? '#10b981' : s.accuracyM < 100 ? '#f59e0b' : '#ef4444';
  const mode = s.drivingMode ? '🚗 Conduite (10s)' : s.batterySaverActive ? '🔋 Économie (120s)' : `Standard (${s.intervalSec}s)`;
  const lastFix = s.lastFixAt ? timeAgo(new Date(s.lastFixAt)) : 'jamais';
  body.innerHTML = `
    <div>Précision : <span style="color:${accColor};font-weight:600">${acc}</span></div>
    <div>Mode : ${mode}</div>
    <div>Plateforme : ${s.native ? 'App native (background)' : 'Web (premier plan)'}</div>
    <div>Wake-Lock : ${s.hasWakeLock ? '✅ actif' : '⚪ inactif'}</div>
    <div>Dernier point : ${lastFix}</div>
    ${s.isPrivate ? '<div style="color:#f59e0b">⚠ Mode privé — pas de partage</div>' : ''}`;
}

// ── Locate ────────────────────────────────────────────────────────────────────
function setupLocate() {
  document.getElementById('locateBtn').addEventListener('click', () => {
    const latlng = GeoModule.getCurrentLatLng();
    if (latlng) {
      MapModule.getMap().setView(latlng, 16, { animate: true });
      return;
    }
    if (!navigator.geolocation) {
      showToast('⚠️ GPS non supporté', 'Votre navigateur ne supporte pas la géolocalisation');
      return;
    }
    showToast('📡 Recherche GPS…', 'Acceptez la permission dans votre navigateur');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        MapModule.getMap().setView([latitude, longitude], 16, { animate: true });
      },
      () => showToast('⚠️ GPS indisponible', 'Activez la géolocalisation dans les paramètres du navigateur'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

// ── Places (lieux favoris) ─────────────────────────────────────────────────
let pendingPlaceLat = null;
let pendingPlaceLng = null;

async function loadPlaces() {
  try {
    const places = await API.get('/api/places');
    MapModule.renderPlaces(places);
  } catch (err) {
    console.warn('[places]', err.message);
  }
}

function setupPlaces() {
  const overlay = document.getElementById('placeOverlay');
  let selectedIcon = 'home';

  MapModule.setOnLongPress((lat, lng) => {
    pendingPlaceLat = lat;
    pendingPlaceLng = lng;
    document.getElementById('placeName').value = '';
    selectedIcon = 'home';
    document.querySelectorAll('.icon-btn').forEach((b) => b.classList.remove('active'));
    document.querySelector('.icon-btn[data-icon="home"]').classList.add('active');
    overlay.classList.remove('hidden');
    setTimeout(() => document.getElementById('placeName').focus(), 150);
  });

  document.querySelectorAll('.icon-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.icon-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedIcon = btn.dataset.icon;
    });
  });

  document.getElementById('savePlace').addEventListener('click', async () => {
    const name = document.getElementById('placeName').value.trim();
    if (!name) { showToast('⚠️ Entrez un nom', ''); return; }
    const notes = (document.getElementById('placeNotes')?.value || '').trim();
    try {
      const place = await API.post('/api/places', {
        name,
        icon: selectedIcon,
        latitude: pendingPlaceLat,
        longitude: pendingPlaceLng,
        notes,
      });
      MapModule.addPlace(place);
      overlay.classList.add('hidden');
      showToast(`📍 ${place.name} ajouté`, '');
    } catch (err) {
      showToast('Erreur', err.message);
    }
  });

  document.getElementById('cancelPlace').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });

  window._deletePlaceCallback = async (id) => {
    try {
      await API.delete(`/api/places/${id}`);
      MapModule.removePlace(id);
      showToast('Lieu supprimé', '');
    } catch (err) {
      showToast('Erreur', err.message);
    }
  };

  window._editPlaceNotesCallback = async (id, name) => {
    const notes = prompt(`Notes pour « ${name } » :`, '');
    if (notes === null) return;
    try {
      const updated = await API.patch(`/api/places/${id}`, { notes });
      MapModule.removePlace(id);
      MapModule.addPlace(updated);
      showToast(`📝 Notes mises à jour`, '');
    } catch (err) {
      showToast('Erreur', err.message);
    }
  };
}

// ── Profile ───────────────────────────────────────────────────────────────────
function setupProfile() {
  const overlay = document.getElementById('profileOverlay');

  document.getElementById('btnProfile').addEventListener('click', () => {
    document.getElementById('profileName').value    = currentUser.name;
    document.getElementById('profileColor').value   = currentUser.color;
    document.getElementById('profileStatus').value  = currentUser.status || '';

    const avatar = document.getElementById('profileAvatar');
    avatar.style.background = currentUser.color;
    if (currentUser.avatar_url) {
      avatar.innerHTML = `<img src="${currentUser.avatar_url}" alt="">`;
    } else {
      avatar.textContent = currentUser.name.slice(0, 2).toUpperCase();
    }

    overlay.classList.remove('hidden');
    loadShareLinks();
  });

  document.getElementById('closeProfile').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });

  document.getElementById('btnLogout').addEventListener('click', () => {
    GeoModule.stop();
    localStorage.removeItem('ft_token');
    location.href = '/login.html';
  });

  // Avatar upload
  document.getElementById('avatarWrap').addEventListener('click', () => {
    document.getElementById('avatarInput').click();
  });

  document.getElementById('avatarInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      const data = await API.upload(`/api/members/${currentUser.id}/avatar`, fd);
      currentUser.avatar_url = data.avatar_url;
      document.getElementById('profileAvatar').innerHTML = `<img src="${data.avatar_url}" alt="">`;
      showToast('Photo mise à jour', '');
    } catch (err) {
      showToast('Erreur', err.message);
    }
  });

  document.getElementById('saveProfile').addEventListener('click', async () => {
    const interval    = parseInt(document.getElementById('gpsInterval').value)  || 30;
    const speedLimit  = parseInt(document.getElementById('speedLimit').value)   || 0;
    localStorage.setItem('ft_interval',    interval);
    localStorage.setItem('ft_speed_limit', speedLimit);
    GeoModule.setInterval(interval);
    GeoModule.setSpeedAlert(speedLimit, onSpeedAlert);

    try {
      const updated = await API.patch(`/api/members/${currentUser.id}`, {
        name:   document.getElementById('profileName').value,
        color:  document.getElementById('profileColor').value,
        status: document.getElementById('profileStatus').value,
      });
      Object.assign(currentUser, updated);
      showToast('Profil enregistré', '');
      overlay.classList.add('hidden');
    } catch (err) {
      showToast('Erreur', err.message);
    }
  });

  document.querySelectorAll('.quick-status-btn').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.getElementById('profileStatus').value = chip.dataset.status;
    });
  });

  // Driving profile chips
  const savedProfile = localStorage.getItem('ft_driving_profile') || 'car';
  document.querySelectorAll('.profile-chip').forEach((chip) => {
    if (chip.dataset.profile === savedProfile) chip.classList.add('active');
    else chip.classList.remove('active');
    chip.addEventListener('click', () => {
      document.querySelectorAll('.profile-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const interval = parseInt(chip.dataset.interval);
      document.getElementById('gpsInterval').value = interval;
      localStorage.setItem('ft_driving_profile', chip.dataset.profile);
      localStorage.setItem('ft_interval', interval);
      GeoModule.setInterval(interval);
      showToast(`${chip.textContent.trim()} activé`, `GPS toutes les ${interval}s`);
    });
  });

  // SOS passif toggle
  const sosPassiveToggle = document.getElementById('sosPassiveToggle');
  sosPassiveToggle.checked = localStorage.getItem('ft_sos_passive') === '1';
  updateSosPassiveStatus();
  sosPassiveToggle.addEventListener('change', () => {
    if (sosPassiveToggle.checked) {
      startSosPassive();
    } else {
      stopSosPassive();
    }
    updateSosPassiveStatus();
  });

  // Crash detection toggle
  const crashToggle = document.getElementById('crashDetectionToggle');
  if (crashToggle) {
    crashToggle.checked = localStorage.getItem('ft_crash_detection') === '1';
    crashToggle.addEventListener('change', () => {
      const on = crashToggle.checked;
      localStorage.setItem('ft_crash_detection', on ? '1' : '0');
      GeoModule.enableCrashDetection(on);
      showToast(on ? '🚨 Détection choc activée' : '🚨 Détection choc désactivée', on ? 'Un SOS sera envoyé après 30s sans annulation' : '', on ? 'ok' : '');
    });
  }

  // Share links
  document.getElementById('createShareLink').addEventListener('click', createShareLink);

  document.getElementById('testPush').addEventListener('click', async () => {
    try {
      await PushModule.subscribe();
      await API.post('/api/notify/test', {});
      showToast('Notification test envoyée', '');
    } catch (err) {
      showToast('Erreur', err.message);
    }
  });
}

// ── History (lazy-loaded) ──────────────────────────────────────────────────
// Full implementation in /js/history.js (~225 lines), pulled in on first
// navHistory click. Saves parse time for sessions that never browse trips.
function setupHistory() {
  const navBtn = document.getElementById('navHistory');
  if (!navBtn) return;
  navBtn.addEventListener('click', async () => {
    try {
      await loadScript('/js/history.js?v=24');
      setupHistory();        // history.js redefines this global with the real impl
      navBtn.click();        // re-fire so the panel opens
    } catch (err) {
      console.error('[history] lazy-load failed:', err);
      showToast('Erreur', 'Impossible de charger le module Historique');
    }
  }, { once: true });
}


// ── PWA Install ───────────────────────────────────────────────────────────────
let _installPrompt = null;

function setupInstall() {
  const btn = document.getElementById('btnInstall');
  if (!btn) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _installPrompt = e;
    btn.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    btn.classList.add('hidden');
    _installPrompt = null;
    showToast('✅ Application installée !', 'Family Tracker est sur votre écran d\'accueil', 'ok');
  });

  btn.addEventListener('click', async () => {
    if (_installPrompt) {
      _installPrompt.prompt();
      const { outcome } = await _installPrompt.userChoice;
      if (outcome === 'accepted') { _installPrompt = null; btn.classList.add('hidden'); }
    } else if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.navigator.standalone) {
      showToast('📱 Installer sur iOS', 'Appuyez sur Partager ↑ puis « Sur l\'écran d\'accueil »', 'ok');
    }
  });

  // Show on iOS if not already in standalone
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.navigator.standalone) {
    btn.classList.remove('hidden');
  }
}

function formatDuration(from, to) {
  const ms = new Date(to) - new Date(from);
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

// ── Zones ─────────────────────────────────────────────────────────────────────
let zones = [];

async function loadZones() {
  try {
    zones = await API.get('/api/zones');
    MapModule.renderZones(zones);
  } catch {}
}

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
        // Update local zones array
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

// ── Admin (lazy-loaded) ────────────────────────────────────────────────────
// The full admin code lives in /js/admin.js (~390 lines). It is only loaded
// when the user first clicks the Admin nav button, saving parse time for
// the 95%% of users who never use it.
function setupAdmin() {
  const navBtn = document.getElementById('navAdmin');
  if (!navBtn) return;

  // One-time click handler that pulls in admin.js, then forwards the click
  // to the real handler that admin.js has just registered.
  const onFirstClick = async () => {
    try {
      await loadScript('/js/admin.js?v=24');
      // admin.js declares `function setupAdmin()` which overrides this one
      // in the global scope. Call it to wire the real click handler.
      setupAdmin();
      navBtn.click();   // re-fire so the panel actually opens
    } catch (err) {
      console.error('[admin] lazy-load failed:', err);
      showToast('Erreur', 'Impossible de charger le module Admin');
    }
  };
  navBtn.addEventListener('click', onFirstClick, { once: true });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// ── Navigation ─────────────────────────────────────────────────────────────────
function setActiveNav(id) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function setupNavigation() {
  // Map theme toggle
  const btnTheme = document.getElementById('btnMapTheme');
  if (btnTheme) {
    const updateThemeBtn = (theme) => {
      const moonPath = 'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z';
      const sunPath  = 'M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2v-2H2v2zm18 0h2v-2h-2v2zM11 2v2h2V2h-2zm0 18v2h2v-2h-2zM5.99 4.58l-1.41 1.41 1.41 1.41 1.41-1.41-1.41-1.41zm12.02 12.02l-1.41 1.41 1.41 1.41 1.41-1.41-1.41-1.41zM18 6l-1.41-1.41-1.41 1.41 1.41 1.41L18 6zM7.42 18.02L5.99 19.44l1.41 1.41 1.41-1.41-1.39-1.42z';
      btnTheme.querySelector('svg path').setAttribute('d', theme === 'dark' ? moonPath : sunPath);
      btnTheme.title = theme === 'dark' ? 'Passer en carte claire' : 'Passer en carte sombre';
    };
    updateThemeBtn(MapModule.getTheme());
    btnTheme.addEventListener('click', () => {
      const next = MapModule.getTheme() === 'dark' ? 'light' : 'dark';
      MapModule.setTheme(next);
      updateThemeBtn(next);
    });
  }

  // Heatmap toggle
  const btnHeatmap = document.getElementById('btnHeatmap');
  if (btnHeatmap) {
    btnHeatmap.addEventListener('click', async () => {
      if (MapModule.isHeatmapVisible()) {
        MapModule.hideHeatmap();
        btnHeatmap.style.color = '';
        return;
      }
      try {
        showToast('🔥 Chargement heatmap…', '');
        const points = await API.get('/api/history/heatmap?days=30');
        if (!points.length) { showToast('Heatmap', 'Aucune donnée disponible'); return; }
        MapModule.showHeatmap(points);
        btnHeatmap.style.color = 'var(--danger)';
        showToast('🔥 Heatmap activée', `${points.length} points — 30 derniers jours`);
      } catch (err) {
        showToast('Erreur heatmap', err.message);
      }
    });
  }

  document.getElementById('navMap').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    try { MapModule.clearTrip(); } catch {}
    setActiveNav('navMap');
  });

  document.getElementById('navMembers').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    setActiveNav('navMembers');
    try { MapModule.focusAll(); } catch {}
    clearBadge('members');
  });

  document.getElementById('closeSidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    setActiveNav('navMap');
  });

  document.getElementById('navZones').addEventListener('click', () => clearBadge('zones'), true);
  document.getElementById('navChat').addEventListener('click', () => {
    clearBadge('chat');
    setupChatOpen();
  });

  // Alert history button
  document.getElementById('btnAlertHistory')?.addEventListener('click', async () => {
    const overlay = document.getElementById('alertHistoryOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    await loadAlertHistory('all');
    // Wire type filter chips
    overlay.querySelectorAll('.alert-filter-chip').forEach((chip) => {
      chip.addEventListener('click', async () => {
        overlay.querySelectorAll('.alert-filter-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        await loadAlertHistory(chip.dataset.type);
      });
    });
  });
  document.getElementById('closeAlertHistory')?.addEventListener('click', () => {
    document.getElementById('alertHistoryOverlay')?.classList.add('hidden');
  });
}

// ── Chat (lazy-loaded) ─────────────────────────────────────────────────────
// Full chat implementation in /js/chat.js (~250 lines), pulled in on first
// navChat click. Until loaded, the stubs below no-op gracefully so:
//   - socket 'chat_message' events that arrive before the panel is opened
//     don't render (the user will see all messages when they open the panel
//     via loadChatHistory which fetches everything from /api/chat).
//   - The unread badge still increments (handled in app.js socket handler).
let _chatScriptPromise = null;
let _chatWired = false;

async function setupChatOpen() {
  if (!_chatScriptPromise) _chatScriptPromise = loadScript('/js/chat.js?v=24');
  await _chatScriptPromise;
  // chat.js redefines the globals. Wire panel + socket once.
  if (!_chatWired) {
    setupChat();
    setupChatReactions();
    _chatWired = true;
  }
  setupChatOpen();   // calls the real one (chat.js overrode the global)
}

// Pre-load stubs — overridden once chat.js loads. Function declarations are
// hoisted to the global object, so chat.js's same-named functions replace these.
function setupChat() {}
function setupChatReactions() {}
function appendChatMessage(_msg) {}
function scrollChatToBottom(_smooth) {}

// escapeHtml utility — defined here for non-chat code that needs it
// (share-links, RDV labels, etc.). chat.js may redeclare it with an
// identical body, no functional difference.
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── ETA ───────────────────────────────────────────────────────────────────────
let cachedPlaces = [];

async function sendEta(text) {
  try {
    await API.post('/api/notify/message', { text });
    showToast('📍 ETA partagé', text, 'ok');
  } catch (err) {
    showToast('Erreur', err.message);
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Driving mode indicator ────────────────────────────────────────────────────
function setupDrivingMode() {
  document.addEventListener('driving-mode', (e) => {
    const badge = document.getElementById('drivingBadge');
    if (!badge) return;
    badge.classList.toggle('hidden', !e.detail.active);
    if (e.detail.active) {
      showToast('🚗 Mode conduite activé', 'GPS toutes les 10 s · Écran maintenu allumé', 'ok');
    }
  });
}

// ── GPX Export ────────────────────────────────────────────────────────────────
function exportGpx(trip) {
  const fmt = (d) => new Date(d).toISOString();
  const trkpts = trip.points.map((p) =>
    `    <trkpt lat="${p.latitude}" lon="${p.longitude}">
      <time>${fmt(p.recorded_at)}</time>${p.speed ? `\n      <speed>${(p.speed / 3.6).toFixed(2)}</speed>` : ''}
    </trkpt>`
  ).join('\n');

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FamilyTracker" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>${fmt(trip.started_at)}</time></metadata>
  <trk>
    <name>Trajet ${new Date(trip.started_at).toLocaleDateString('fr-FR')}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;

  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `trajet_${new Date(trip.started_at).toISOString().slice(0,10)}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('⬇️ GPX exporté', `${trip.point_count} points · ${trip.distance_km} km`);
}

// ── Weekly stats ──────────────────────────────────────────────────────────────
async function loadWeekStats() {
  const container = document.getElementById('weekStatsContainer');
  container.innerHTML = '<p class="text-muted" style="text-align:center;padding:.75rem 0">Chargement…</p>';
  try {
    const rows = await API.get('/api/history/stats/week');
    if (!rows.length) {
      container.innerHTML = '<p class="text-muted" style="text-align:center;padding:.75rem 0">Aucune donnée cette semaine</p>';
      return;
    }
    const maxDist = Math.max(...rows.map((r) => parseFloat(r.distance_km)));
    container.innerHTML = `
      <div class="week-stats-title">📊 Résumé — 7 derniers jours</div>
      ${rows.map((r) => {
        const pct = maxDist > 0 ? (parseFloat(r.distance_km) / maxDist * 100).toFixed(0) : 0;
        return `
        <div class="week-stat-row">
          <div class="week-stat-name" style="color:${r.color}">${r.name}</div>
          <div class="week-stat-bar-wrap">
            <div class="week-stat-bar" style="width:${pct}%;background:${r.color}"></div>
          </div>
          <div class="week-stat-vals">
            <span class="week-stat-km">${r.distance_km} km</span>
            <span class="week-stat-meta">${r.active_days}j · ${r.avg_speed_kmh} km/h moy.</span>
          </div>
        </div>`;
      }).join('')}`;
  } catch (err) {
    container.innerHTML = `<p class="text-danger">Erreur : ${err.message}</p>`;
  }
}

// ── SOS Passif (orientation) ──────────────────────────────────────────────────
let _sosPassiveActive  = false;
let _sosPassiveTimer   = null;
let _sosPassiveSent    = false;

function updateSosPassiveStatus() {
  const el = document.getElementById('sosPassiveStatus');
  if (!el) return;
  const on = document.getElementById('sosPassiveToggle')?.checked;
  el.classList.toggle('hidden', !on);
}

function startSosPassive() {
  if (_sosPassiveActive) return;
  if (!window.DeviceOrientationEvent) {
    showToast('⚠️ Non supporté', 'Capteur d\'orientation non disponible', 'warning');
    document.getElementById('sosPassiveToggle').checked = false;
    return;
  }
  const doStart = () => {
    _sosPassiveActive = true;
    _sosPassiveSent   = false;
    localStorage.setItem('ft_sos_passive', '1');
    window.addEventListener('deviceorientation', _sosOrientationHandler);
    showToast('🔒 SOS passif activé', 'Retournez le téléphone 10s pour alerter', 'ok');
  };

  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then((perm) => {
      if (perm === 'granted') doStart();
      else {
        showToast('⚠️ Permission refusée', 'Autorisation capteur requise', 'warning');
        document.getElementById('sosPassiveToggle').checked = false;
      }
    }).catch(() => {
      document.getElementById('sosPassiveToggle').checked = false;
    });
  } else {
    doStart();
  }
}

function stopSosPassive() {
  _sosPassiveActive = false;
  localStorage.setItem('ft_sos_passive', '0');
  window.removeEventListener('deviceorientation', _sosOrientationHandler);
  if (_sosPassiveTimer) { clearTimeout(_sosPassiveTimer); _sosPassiveTimer = null; }
}

function _sosOrientationHandler(e) {
  const beta = e.beta; // -180 to 180; face-down ≈ ±180
  const faceDown = beta !== null && Math.abs(beta) > 155;
  if (faceDown && !_sosPassiveTimer && !_sosPassiveSent) {
    _sosPassiveTimer = setTimeout(async () => {
      _sosPassiveSent = true;
      _sosPassiveTimer = null;
      try {
        await API.post('/api/notify/sos', {});
        showToast('🆘 SOS passif envoyé', 'Votre famille a été alertée en silence', 'warning');
      } catch {}
    }, 10_000);
  } else if (!faceDown && _sosPassiveTimer) {
    clearTimeout(_sosPassiveTimer);
    _sosPassiveTimer = null;
  }
  if (!faceDown) _sosPassiveSent = false;
}

// Restore SOS passive on startup
if (localStorage.getItem('ft_sos_passive') === '1') {
  startSosPassive();
}

// ── Share Links ───────────────────────────────────────────────────────────────
async function loadShareLinks() {
  const container = document.getElementById('shareLinksContainer');
  if (!container) return;
  try {
    const links = await API.get('/api/share');
    if (!links.length) { container.innerHTML = ''; return; }
    container.innerHTML = links.map((l) => {
      const url     = `${location.origin}/share.html?t=${l.token}`;
      const expires = new Date(l.expires_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="share-link-row">
          <div style="flex:1;min-width:0">
            <div class="share-link-label">${escapeHtml(l.label || 'Lien sans titre')}</div>
            <div class="share-link-url" title="${url}">${url}</div>
            <div style="font-size:.72rem;color:var(--text-muted)">Expire aujourd'hui à ${expires}</div>
          </div>
          <div style="display:flex;gap:.4rem;flex-shrink:0">
            <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText('${url}');showToast('✅ Copié','')">Copier</button>
            <button class="btn btn-danger btn-sm" data-revoke="${l.token}">✕</button>
          </div>
        </div>`;
    }).join('');
    container.querySelectorAll('[data-revoke]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await API.delete(`/api/share/${btn.dataset.revoke}`);
          await loadShareLinks();
          showToast('Lien révoqué', '');
        } catch (err) { showToast('Erreur', err.message); }
      });
    });
  } catch { container.innerHTML = ''; }
}

async function createShareLink() {
  const label = document.getElementById('shareLabel').value.trim();
  try {
    await API.post('/api/share', { label });
    document.getElementById('shareLabel').value = '';
    showToast('🔗 Lien créé', 'Partageable 24h — visible dans votre profil', 'ok');
    await loadShareLinks();
  } catch (err) { showToast('Erreur', err.message); }
}

// ── CSV Export ────────────────────────────────────────────────────────────────
async function exportTripsCsv(userId, from, to, memberName) {
  try {
    const trips = await API.get(`/api/history?userId=${userId}&from=${from}&to=${to}`);
    if (!trips.length) { showToast('Aucun trajet', 'Pas de données à exporter'); return; }

    const lines = [
      ['Date', 'Départ', 'Arrivée', 'Durée (min)', 'Distance (km)', 'Vitesse moy (km/h)', 'Vitesse max (km/h)', 'Points GPS'].join(';'),
    ];

    for (const t of trips) {
      const date    = new Date(t.started_at).toLocaleDateString('fr-FR');
      const depart  = new Date(t.started_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const arrivee = new Date(t.ended_at).toLocaleTimeString('fr-FR',   { hour: '2-digit', minute: '2-digit' });
      const durMin  = Math.round((new Date(t.ended_at) - new Date(t.started_at)) / 60_000);
      lines.push([date, depart, arrivee, durMin, t.distance_km, t.avg_speed_kmh, t.max_speed_kmh || 0, t.point_count].join(';'));
    }

    const csv  = '﻿' + lines.join('\r\n'); // BOM for Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `trajets_${memberName}_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('⬇️ CSV exporté', `${trips.length} trajet${trips.length > 1 ? 's' : ''}`);
  } catch (err) {
    showToast('Erreur export', err.message);
  }
}

// ── Global GPX Export ─────────────────────────────────────────────────────────
async function exportGpxGlobal(userId, from, to, memberName) {
  try {
    showToast('⬇️ Préparation GPX…', '');
    const pts = await API.get(`/api/history/raw?userId=${userId}&from=${from}T00:00:00&to=${to}T23:59:59`);
    if (!pts.length) { showToast('Aucun point GPS', 'Pas de données à exporter'); return; }

    // Split into segments by 10-min gaps
    const GAP_MS = 10 * 60_000;
    const segments = [];
    let seg = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (new Date(pts[i].recorded_at) - new Date(pts[i-1].recorded_at) > GAP_MS) {
        segments.push(seg);
        seg = [pts[i]];
      } else {
        seg.push(pts[i]);
      }
    }
    segments.push(seg);

    const fmt = (d) => new Date(d).toISOString();
    const trksegs = segments.map((s) => `
    <trkseg>
${s.map((p) => `      <trkpt lat="${p.latitude}" lon="${p.longitude}"><time>${fmt(p.recorded_at)}</time>${p.speed ? `<speed>${(p.speed / 3.6).toFixed(2)}</speed>` : ''}</trkpt>`).join('\n')}
    </trkseg>`).join('');

    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FamilyTracker" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>${fmt(from + 'T00:00:00')}</time></metadata>
  <trk>
    <name>${memberName} — ${from} → ${to}</name>${trksegs}
  </trk>
</gpx>`;

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `gps_${memberName}_${from}_${to}.gpx`; a.click();
    URL.revokeObjectURL(url);
    showToast('⬇️ GPX exporté', `${pts.length} points · ${segments.length} segment(s)`);
  } catch (err) {
    showToast('Erreur GPX', err.message);
  }
}

// ── Alert history ─────────────────────────────────────────────────────────────
const ALERT_ICONS = {
  sos: '🆘', ok_signal: '✅', quick_message: '💬', speed_alert: '⚡',
  geofence_enter: '📍', geofence_exit: '👋', battery: '🔋', disconnect: '📵',
};
const ALERT_LABELS = {
  sos: 'SOS', ok_signal: 'Je suis OK', quick_message: 'Message rapide',
  speed_alert: 'Excès vitesse', geofence_enter: 'Entrée zone', geofence_exit: 'Sortie zone',
  battery: 'Batterie faible', disconnect: 'Déconnexion',
};

async function loadAlertHistory(typeFilter = 'all') {
  const container = document.getElementById('alertHistoryContainer');
  if (!container) return;
  container.innerHTML = '<p class="text-muted" style="text-align:center;padding:.75rem 0">Chargement…</p>';

  try {
    const url = typeFilter === 'all'
      ? '/api/notify/history?type=all&limit=50'
      : `/api/notify/history?type=${typeFilter}&limit=50`;
    const rows = await API.get(url);

    if (!rows.length) {
      container.innerHTML = '<p class="text-muted" style="text-align:center;padding:.75rem 0">Aucune alerte</p>';
      return;
    }

    container.innerHTML = rows.map((r) => {
      const icon  = ALERT_ICONS[r.type] || '📢';
      const label = ALERT_LABELS[r.type] || r.type;
      const when  = new Date(r.sent_at).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      const p     = r.payload || {};
      const detail = p.text || (p.zone?.name ? `Zone: ${p.zone.name}` : p.speed ? `${p.speed} km/h` : '');
      return `
        <div class="alert-hist-row">
          <span class="alert-hist-icon">${icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:.84rem;color:${r.sender_color || 'var(--text-2)'}">${r.sender_name || 'Système'} <span style="font-weight:400;color:var(--text-muted)">· ${label}</span></div>
            ${detail ? `<div style="font-size:.77rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${detail}</div>` : ''}
          </div>
          <span style="font-size:.7rem;color:var(--text-muted);flex-shrink:0">${when}</span>
        </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<p class="text-danger" style="font-size:.82rem">Erreur : ${err.message}</p>`;
  }
}

// ── Monthly stats (admin) ─────────────────────────────────────────────────────
async function loadMonthStats() {
  try {
    const rows = await API.get('/api/history/stats/month');
    return rows;
  } catch { return []; }
}

// ── Timeline journalière ──────────────────────────────────────────────────────
const TIMELINE_ICONS = {
  home: '🏠', work: '💼', school: '🏫', sport: '🏋️', shop: '🛒', star: '⭐', zone: '📍',
};

async function loadTimeline() {
  const userId = document.getElementById('historyMember').value;
  const date   = document.getElementById('historyFrom').value;
  const container = document.getElementById('timelineContainer');
  if (!userId || !date) return;

  container.innerHTML = '<p class="text-muted" style="text-align:center;padding:.75rem 0">Chargement…</p>';

  try {
    const events = await API.get(`/api/history/timeline?userId=${userId}&date=${date}`);
    if (!events.length) {
      container.innerHTML = '<p class="text-muted" style="text-align:center;padding:.75rem 0">Aucune donnée ce jour</p>';
      return;
    }

    const fmtTime = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const fmtDur  = (ms) => {
      const m = Math.floor(ms / 60_000);
      return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 > 0 ? ` ${m % 60}min` : ''}`;
    };

    container.innerHTML = `
      <div class="timeline-title">📅 Timeline — ${new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div class="timeline-list">
        ${events.map((ev) => {
          const icon  = ev.type === 'stay' ? (TIMELINE_ICONS[ev.icon] || '📍') : '🚗';
          const label = ev.type === 'stay'
            ? (ev.label || 'Lieu inconnu')
            : `En déplacement${ev.distance_m > 100 ? ` · ${(ev.distance_m / 1000).toFixed(1)} km` : ''}`;
          const sub = ev.type === 'stay'
            ? fmtDur(ev.duration_ms)
            : (ev.avg_speed > 0 ? `${ev.avg_speed} km/h moy.` : '');
          return `
            <div class="timeline-item ${ev.type}">
              <div class="timeline-time">${fmtTime(ev.started_at)}</div>
              <div class="timeline-dot-wrap">
                <div class="timeline-dot ${ev.type}"></div>
                <div class="timeline-line"></div>
              </div>
              <div class="timeline-content">
                <div class="timeline-icon">${icon}</div>
                <div>
                  <div class="timeline-label">${label}</div>
                  ${sub ? `<div class="timeline-sub">${sub}</div>` : ''}
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  } catch (err) {
    container.innerHTML = `<p class="text-danger">Erreur : ${err.message}</p>`;
  }
}

// ── Schedule alerts UI ────────────────────────────────────────────────────────
function setupSchedule() {
  // Populate member/zone selects when zones panel opens
  document.getElementById('navZones').addEventListener('click', async () => {
    await populateScheduleSelects();
    await renderScheduleList();
  }, { capture: true });

  document.querySelectorAll('.day-chip').forEach((btn) => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  document.getElementById('createSchedule').addEventListener('click', async () => {
    const member_id     = document.getElementById('schedMember').value;
    const zone_id       = document.getElementById('schedZone').value;
    const label         = document.getElementById('schedLabel').value.trim();
    const expected_time = document.getElementById('schedTime').value;
    const tolerance_min = parseInt(document.getElementById('schedTolerance').value) || 15;
    const days          = [...document.querySelectorAll('.day-chip.active')].map((b) => b.dataset.day);

    if (!member_id || !zone_id || !expected_time) {
      showToast('⚠️ Champs manquants', 'Membre, zone et heure sont requis'); return;
    }

    try {
      await API.post('/api/schedule', { member_id, zone_id, label, expected_time, tolerance_min, days });
      showToast('⏰ Alerte créée', label || `${expected_time}`);
      document.getElementById('schedLabel').value = '';
      await renderScheduleList();
    } catch (err) { showToast('Erreur', err.message); }
  });
}

async function populateScheduleSelects() {
  const selM = document.getElementById('schedMember');
  const selZ = document.getElementById('schedZone');
  if (!selM || !selZ) return;

  // Refresh both lists to ensure they're current
  try { await loadZones(); } catch {}
  try { await refreshPositions(); } catch {}

  const members = Object.values(memberData);
  selM.innerHTML = members.length
    ? members.map((m) => `<option value="${m.id}">${m.name}</option>`).join('')
    : '<option value="">Aucun membre</option>';

  selZ.innerHTML = zones.length
    ? zones.map((z) => `<option value="${z.id}">${z.name}</option>`).join('')
    : '<option value="">Aucune zone — créez-en une d\'abord</option>';
}

// ── Crash detection (choc/accident) ──────────────────────────────────────────
let _crashCountdownTimer  = null;
let _crashCountdownValue  = 30;

function setupCrashDetection() {
  // Restore from localStorage
  if (localStorage.getItem('ft_crash_detection') === '1') {
    GeoModule.enableCrashDetection(true);
    const toggle = document.getElementById('crashDetectionToggle');
    if (toggle) toggle.checked = true;
  }

  document.addEventListener('crash-warning', startCrashCountdown);

  const cancelBtn = document.getElementById('crashCancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', cancelCrashCountdown);
  }
}

function startCrashCountdown() {
  if (_crashCountdownTimer) return; // already running

  const overlay = document.getElementById('crashWarningOverlay');
  if (!overlay) return;

  _crashCountdownValue = 30;
  overlay.classList.remove('hidden');
  document.getElementById('crashCountdown').textContent = _crashCountdownValue;

  // vibrate if available
  if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);

  _crashCountdownTimer = setInterval(async () => {
    _crashCountdownValue--;
    const el = document.getElementById('crashCountdown');
    if (el) el.textContent = _crashCountdownValue;

    if (_crashCountdownValue <= 0) {
      clearInterval(_crashCountdownTimer);
      _crashCountdownTimer = null;
      overlay.classList.add('hidden');
      // Send SOS
      try {
        const latlng = GeoModule.getCurrentLatLng();
        const body = latlng ? { latitude: latlng[0], longitude: latlng[1] } : {};
        await API.post('/api/notify/sos', body);
        showToast('🆘 SOS auto envoyé', 'Choc détecté — famille alertée', 'sos');
      } catch {}
    }
  }, 1000);
}

function cancelCrashCountdown() {
  if (_crashCountdownTimer) { clearInterval(_crashCountdownTimer); _crashCountdownTimer = null; }
  const overlay = document.getElementById('crashWarningOverlay');
  if (overlay) overlay.classList.add('hidden');
  showToast('✅ Alerte annulée', 'Pas d\'accident détecté');
}

// ── Heatmap setup ─────────────────────────────────────────────────────────────
function setupHeatmap() {
  // nothing — button listener is in setupNavigation
}

// ── Routines récurrentes ──────────────────────────────────────────────────────
async function loadRoutines() {
  const userId = document.getElementById('historyMember').value;
  const container = document.getElementById('routinesContainer');
  if (!container) return;

  container.innerHTML = '<p class="text-muted" style="text-align:center;padding:.75rem 0">Analyse des routines…</p>';

  try {
    const routines = await API.get(`/api/history/routines?userId=${userId}`);
    if (!routines.length) {
      container.innerHTML = '<p class="text-muted" style="text-align:center;padding:.75rem 0">Aucune routine détectée (60 jours, min. 3 répétitions)</p>';
      return;
    }

    container.innerHTML = `
      <div class="timeline-title">🔄 Trajets récurrents — 60 derniers jours</div>
      ${routines.map((r, i) => `
        <div class="routine-card">
          <div class="routine-header">
            <span class="routine-rank">#${i + 1}</span>
            <span class="routine-count">${r.count}×</span>
          </div>
          <div class="routine-info">
            <div class="routine-time">⏰ Départ habituel : ${r.avg_hour}</div>
            <div class="routine-dist">📏 ${r.avg_distance_km} km · ${r.avg_speed_kmh} km/h moy.</div>
          </div>
        </div>`).join('')}`;
  } catch (err) {
    container.innerHTML = `<p class="text-danger">Erreur : ${err.message}</p>`;
  }
}

// ── Feature 9: Mode "Je rentre seul(e)" ──────────────────────────────────────
let _safeReturnTimer = null;
let _safeReturnInterval = null;
let _safeReturnDest = null;
let _safeReturnMinutes = 15;

function setupSafeReturn() {
  document.getElementById('btnProfile').addEventListener('click', async () => {
    const places = await API.get('/api/places').catch(() => []);
    const sel = document.getElementById('safeReturnDest');
    if (sel) sel.innerHTML = places.length
      ? places.map(p => `<option value="${p.latitude},${p.longitude}">${p.name}</option>`).join('')
      : '<option>Aucun lieu sauvegardé</option>';
  }, { capture: false });

  document.querySelectorAll('#safeReturnChips .profile-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#safeReturnChips .profile-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      _safeReturnMinutes = parseInt(chip.dataset.minutes);
    });
  });

  document.getElementById('startSafeReturn')?.addEventListener('click', () => {
    if (_safeReturnTimer) { cancelSafeReturn(); return; }

    const destVal = document.getElementById('safeReturnDest')?.value;
    if (destVal && destVal.includes(',')) {
      const [lat, lon] = destVal.split(',').map(Number);
      _safeReturnDest = { lat, lon };
    }

    _safeReturnMinutes = parseInt(document.querySelector('#safeReturnChips .profile-chip.active')?.dataset.minutes) || 15;
    let remaining = _safeReturnMinutes * 60;

    showToast(`🚶 Retour armé`, `SOS dans ${_safeReturnMinutes} min si pas arrivé`, 'ok');
    const btn = document.getElementById('startSafeReturn');
    btn.textContent = `⏱ Annuler (${_safeReturnMinutes} min)`;
    btn.classList.add('btn-danger');
    document.getElementById('closeProfile')?.click();

    _safeReturnInterval = setInterval(() => {
      remaining -= 30;
      if (_safeReturnDest) {
        const latlng = GeoModule.getCurrentLatLng();
        if (latlng) {
          const dist = haversineKm(latlng[0], latlng[1], _safeReturnDest.lat, _safeReturnDest.lon) * 1000;
          if (dist < 200) {
            cancelSafeReturn();
            showToast('✅ Arrivée détectée !', 'Mode retour désarmé automatiquement', 'ok');
            return;
          }
        }
      }
      if (remaining <= 0) {
        clearInterval(_safeReturnInterval);
        _safeReturnInterval = null;
        _safeReturnTimer = null;
        triggerSafeReturnSOS();
      }
    }, 30_000);

    _safeReturnTimer = true;
  });
}

function cancelSafeReturn() {
  if (_safeReturnInterval) { clearInterval(_safeReturnInterval); _safeReturnInterval = null; }
  _safeReturnTimer = null;
  _safeReturnDest = null;
  const btn = document.getElementById('startSafeReturn');
  if (btn) { btn.textContent = '🚶 Armer le retour'; btn.classList.remove('btn-danger'); }
}

async function triggerSafeReturnSOS() {
  showToast('🆘 SOS retour automatique', "Vous n'êtes pas arrivé à destination", 'sos');
  try {
    const latlng = GeoModule.getCurrentLatLng();
    await API.post('/api/notify/sos', latlng ? { latitude: latlng[0], longitude: latlng[1] } : {});
  } catch {}
}

// ── Feature 10: Check-in régulier ───────────────────────────────────────────
let _checkinInterval = null;
let _checkinTimer = null;

function setupCheckin() {
  const toggle = document.getElementById('checkinToggle');
  const intervalSel = document.getElementById('checkinInterval');
  if (!toggle) return;

  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      intervalSel?.classList.remove('hidden');
      startCheckin();
    } else {
      intervalSel?.classList.add('hidden');
      stopCheckin();
    }
  });

  intervalSel?.addEventListener('change', () => {
    if (toggle.checked) {
      stopCheckin();
      startCheckin();
    }
  });
}

function startCheckin() {
  stopCheckin();
  const intervalSel = document.getElementById('checkinInterval');
  const intervalMin = parseInt(intervalSel?.value) || 60;
  const intervalMs = intervalMin * 60 * 1000;

  _checkinInterval = setInterval(() => {
    showCheckinPrompt(intervalMin);
  }, intervalMs);

  showToast('✋ Check-in activé', `Confirmation requise toutes les ${intervalMin} min`, 'ok');
}

function stopCheckin() {
  if (_checkinInterval) { clearInterval(_checkinInterval); _checkinInterval = null; }
  if (_checkinTimer) { clearTimeout(_checkinTimer); _checkinTimer = null; }
}

function showCheckinPrompt(intervalMin) {
  showToast('✋ Check-in requis', 'Appuyez pour confirmer votre présence', 'warning');

  // Auto-alert after 5 min if no response
  _checkinTimer = setTimeout(async () => {
    showToast('⚠️ Check-in manqué', 'La famille a été alertée de votre absence de réponse', 'warning');
    try {
      await API.post('/api/notify/message', { text: `⚠️ ${currentUser?.name || 'Un membre'} n'a pas confirmé son check-in` });
    } catch {}
  }, 5 * 60 * 1000);

  // Create a dismissable toast with confirm action
  const toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) return;

  const confirmToast = document.createElement('div');
  confirmToast.className = 'toast toast-warning';
  confirmToast.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem">
      <span>✋ Confirmez votre présence</span>
      <button class="btn btn-primary btn-sm" id="checkinConfirmBtn">Je suis là ✅</button>
    </div>`;
  toastContainer.appendChild(confirmToast);

  confirmToast.querySelector('#checkinConfirmBtn')?.addEventListener('click', async () => {
    if (_checkinTimer) { clearTimeout(_checkinTimer); _checkinTimer = null; }
    confirmToast.remove();
    try {
      await API.patch(`/api/members/${currentUser.id}`, { last_checkin_at: new Date().toISOString() });
      showToast('✅ Check-in confirmé', '', 'ok');
    } catch {}
  });

  // Auto-remove after 5 minutes
  setTimeout(() => confirmToast.remove(), 5 * 60 * 1000);
}

// ── Feature 11: Partage de destination (RDV) ─────────────────────────────────
// Extends setupEta — adds RDV section after the places list

function setupEta() {
  const etaBtn = document.getElementById('etaBtn');
  const overlay = document.getElementById('etaOverlay');

  etaBtn.addEventListener('click', async () => {
    const latlng = GeoModule.getCurrentLatLng();
    if (!latlng) {
      showToast('⚠️ Position inconnue', 'Activez le partage GPS d\'abord', 'warning');
      return;
    }

    if (!cachedPlaces.length) {
      try { cachedPlaces = await API.get('/api/places'); } catch {}
    }

    const speed = GeoModule.getCurrentSpeed();
    const effectiveSpeed = speed > 10 ? speed : 30;

    const list = document.getElementById('etaPlaceList');
    if (!cachedPlaces.length) {
      list.innerHTML = '<p class="text-muted" style="font-size:.82rem">Aucun lieu favori enregistré. Créez-en depuis la carte (appui long).</p>';
    } else {
      list.innerHTML = cachedPlaces.map((p) => {
        const distKm = haversineKm(latlng[0], latlng[1], p.latitude, p.longitude);
        const etaMin = Math.round((distKm / effectiveSpeed) * 60);
        const etaStr = etaMin < 1 ? '< 1 min' : etaMin < 60 ? `${etaMin} min` : `${Math.floor(etaMin/60)}h${etaMin%60 > 0 ? ` ${etaMin%60}min` : ''}`;
        const icon   = { home:'🏠', work:'💼', school:'🏫', sport:'🏋️', shop:'🛒', star:'⭐' }[p.icon] || '📍';
        return `
          <div class="eta-place-row" data-name="${escapeHtml(p.name)}" data-eta="${etaStr}" data-icon="${icon}">
            <div class="eta-place-info">
              <span class="eta-place-icon">${icon}</span>
              <span class="eta-place-name">${p.name}</span>
            </div>
            <div class="eta-place-time">
              <span class="eta-place-duration">${etaStr}</span>
              <span class="eta-place-dist">${distKm < 1 ? `${Math.round(distKm*1000)} m` : `${distKm.toFixed(1)} km`}</span>
            </div>
          </div>`;
      }).join('');

      list.querySelectorAll('.eta-place-row').forEach((row) => {
        row.addEventListener('click', async () => {
          const msg = `${row.dataset.icon} J'arrive dans ~${row.dataset.eta} à ${row.dataset.name}`;
          await sendEta(msg);
          overlay.classList.add('hidden');
        });
      });
    }

    // RDV section
    const rdvList = document.getElementById('etaRdvList');
    if (rdvList && cachedPlaces.length) {
      rdvList.innerHTML = cachedPlaces.map((p) => {
        const icon = { home:'🏠', work:'💼', school:'🏫', sport:'🏋️', shop:'🛒', star:'⭐' }[p.icon] || '📍';
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`;
        return `<button class="btn btn-ghost" style="margin-bottom:.4rem;width:100%;text-align:left" data-rdv-name="${escapeHtml(p.name)}" data-rdv-maps="${mapsUrl}">${icon} ${p.name}</button>`;
      }).join('');

      rdvList.querySelectorAll('[data-rdv-name]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const msgText = `📍 Rendez-vous à ${btn.dataset.rdvName} ! ${btn.dataset.rdvMaps}`;
          try {
            await API.post('/api/chat', { text: msgText });
            showToast('📍 RDV partagé', btn.dataset.rdvName, 'ok');
          } catch (err) {
            showToast('Erreur', err.message);
          }
          overlay.classList.add('hidden');
        });
      });
    }

    overlay.classList.remove('hidden');
  });

  document.getElementById('etaSendCustom').addEventListener('click', async () => {
    const dest = document.getElementById('etaCustomDest').value.trim();
    if (!dest) { showToast('⚠️ Entrez une destination', ''); return; }
    await sendEta(`📍 En route vers ${dest}`);
    document.getElementById('etaCustomDest').value = '';
    overlay.classList.add('hidden');
  });

  document.getElementById('closeEta').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });
}

// ── Feature 12: Classement mensuel ──────────────────────────────────────────
async function loadMonthRanking() {
  const container = document.getElementById('rankingContainer');
  if (!container) return;
  container.innerHTML = '<p class="text-muted" style="text-align:center;padding:.75rem 0">Chargement…</p>';

  try {
    const rows = await API.get('/api/history/stats/month');
    if (!rows.length) {
      container.innerHTML = '<p class="text-muted" style="text-align:center;padding:.75rem 0">Aucune donnée ce mois</p>';
      return;
    }

    const medals = ['🥇','🥈','🥉'];
    container.innerHTML = `
      <div class="week-stats-title">🏆 Classement mensuel — 30 derniers jours</div>
      ${rows.map((r, i) => {
        const badges = computeBadges(r, rows);
        const rank = medals[i] || `${i + 1}.`;
        return `
        <div class="ranking-row">
          <div class="ranking-rank">${rank}</div>
          <div class="member-avatar" style="width:32px;height:32px;font-size:.78rem;flex-shrink:0;background:${r.color}">${r.name.slice(0,2).toUpperCase()}</div>
          <div class="ranking-info">
            <div class="ranking-name" style="color:${r.color}">${r.name}</div>
            <div class="ranking-stats">${r.distance_km} km · ${r.active_days}j actifs · max ${r.max_speed_kmh} km/h</div>
            ${badges.length ? `<div class="ranking-badges">${badges.map(b => `<span class="badge-chip">${b}</span>`).join('')}</div>` : ''}
          </div>
          <div style="font-weight:800;font-size:1.1rem;color:var(--primary-l);flex-shrink:0">${r.distance_km}<small style="font-size:.65rem;font-weight:400">km</small></div>
        </div>`;
      }).join('')}`;
  } catch (err) {
    container.innerHTML = `<p class="text-danger">Erreur : ${err.message}</p>`;
  }
}

// ── Feature 13: Badges familiaux ────────────────────────────────────────────
function computeBadges(memberStats, allStats) {
  const badges = [];
  const dist = parseFloat(memberStats.distance_km) || 0;
  const maxSpeed = parseFloat(memberStats.max_speed_kmh) || 0;
  const driving = parseFloat(memberStats.driving_km) || 0;

  // 🚗 Grand voyageur
  if (dist > 200) badges.push('🚗 Grand voyageur');

  // 🛡️ Conducteur prudent
  if (maxSpeed > 0 && maxSpeed < 90) badges.push('🛡️ Conducteur prudent');

  // 🌱 Eco
  if (dist > 0 && driving < dist * 0.5) badges.push('🌱 Éco');

  // 🏆 Champion (highest distance in family)
  if (allStats && allStats.length > 1) {
    const maxDist = Math.max(...allStats.map(r => parseFloat(r.distance_km) || 0));
    if (dist === maxDist && dist > 0) badges.push('🏆 Champion');
  }

  return badges;
}

// ── Feature 14: Comparaison semaine vs semaine ──────────────────────────────
async function loadWeeklyTrend() {
  const container = document.getElementById('weekStatsContainer');
  if (!container) return;

  try {
    const trends = await API.get('/api/history/stats/weekly-trend?weeks=4');
    if (!trends.length) return;

    const maxDist = Math.max(...trends.map(r => parseFloat(r.distance_km) || 0), 1);

    const trendHtml = `
      <div style="font-size:.82rem;font-weight:700;color:var(--text-2);margin:.75rem 0 .4rem">📈 Tendance semaines</div>
      <div class="trend-chart">
        ${trends.map(r => {
          const dist = parseFloat(r.distance_km) || 0;
          const heightPct = Math.max(5, Math.round((dist / maxDist) * 100));
          const weekLabel = new Date(r.week_start).toLocaleDateString('fr-FR', { month: '2-digit', day: '2-digit' });
          return `
          <div class="trend-bar-wrap">
            <div class="trend-bar-val">${dist}</div>
            <div class="trend-bar" style="height:${heightPct}%"></div>
            <div class="trend-bar-label">${weekLabel}</div>
          </div>`;
        }).join('')}
      </div>`;

    // Append to existing stats container
    const existing = container.querySelector('.trend-chart-wrap');
    if (existing) existing.remove();
    const wrap = document.createElement('div');
    wrap.className = 'trend-chart-wrap';
    wrap.innerHTML = trendHtml;
    container.appendChild(wrap);
  } catch (err) {
    console.warn('[weekly-trend]', err.message);
  }
}

async function renderScheduleList() {
  const container = document.getElementById('scheduleList');
  if (!container) return;
  try {
    const list = await API.get('/api/schedule');
    if (!list.length) { container.innerHTML = ''; return; }

    const dayNames = ['', 'L', 'M', 'M', 'J', 'V', 'S', 'D'];
    container.innerHTML = list.map((a) => {
      const daysStr = (a.days || []).map((d) => dayNames[d] || d).join(' ');
      return `
        <div class="sched-row">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.84rem;color:${a.member_color}">${a.member_name}</div>
            <div style="font-size:.78rem;color:var(--text-2)">${a.label || a.zone_name} · ${a.expected_time?.slice(0,5)} (±${a.tolerance_min}min)</div>
            <div style="font-size:.7rem;color:var(--text-muted)">${daysStr}</div>
          </div>
          <div style="display:flex;gap:.3rem;flex-shrink:0">
            <button class="btn btn-ghost btn-sm" data-sched-toggle="${a.id}">${a.active ? '⏸' : '▶'}</button>
            <button class="btn btn-danger btn-sm" data-sched-del="${a.id}">✕</button>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-sched-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await API.patch(`/api/schedule/${btn.dataset.schedToggle}/toggle`, {});
        await renderScheduleList();
      });
    });
    container.querySelectorAll('[data-sched-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await API.delete(`/api/schedule/${btn.dataset.schedDel}`);
        await renderScheduleList();
      });
    });
  } catch { container.innerHTML = ''; }
}
