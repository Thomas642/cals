// ── Bootstrap ────────────────────────────────────────────────────────────────
(async () => {
  await loadCurrentUser();

  MapModule.init();

  // Show admin nav if admin
  if (currentUser.role === 'admin') {
    document.getElementById('navAdmin').classList.remove('hidden');
  }

  // Restore GPS interval preference
  const savedInterval = parseInt(localStorage.getItem('ft_interval')) || 30;
  document.getElementById('gpsInterval').value = savedInterval;

  // Start GPS sharing
  GeoModule.start(savedInterval);

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.warn);
  }

  // Load initial positions
  await refreshPositions();
  await loadZones();

  // Poll positions every 10 s (fallback if WS drops)
  setInterval(refreshPositions, 10_000);

  setupSocket();
  setupSOS();
  setupPrivacy();
  setupProfile();
  setupHistory();
  setupZones();
  setupNavigation();
  setupAdmin();
  setupLocate();
})();

// ── Realtime via WebSocket ────────────────────────────────────────────────────
let socket;

function setupSocket() {
  socket = io({ auth: { token: localStorage.getItem('ft_token') } });

  socket.on('position_update', (data) => {
    MapModule.updateMember(data);
    updateMemberCard(data);
  });

  socket.on('sos', (data) => {
    showToast(`🆘 SOS — ${data.member.name}`, `Position partagée`, 'sos');
    if (data.latitude) MapModule.getMap().setView([data.latitude, data.longitude], 16);
  });

  socket.on('geofence_enter', (data) => {
    showToast(`📍 ${data.member.name} est arrivé(e)`, `Zone : ${data.zone.name}`);
  });

  socket.on('geofence_exit', (data) => {
    showToast(`📍 ${data.member.name} a quitté`, `Zone : ${data.zone.name}`);
  });

  socket.on('battery', (data) => {
    showToast(`🔋 Batterie faible`, `${data.member.name} a une batterie critique`);
  });

  socket.on('disconnect', (data) => {
    if (data?.member) showToast(`⚠️ ${data.member.name} est déconnecté(e)`, '');
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

    const batClass = m.battery != null && m.battery < 20 ? 'battery-icon low' : 'battery-icon';

    card.innerHTML = `
      <div class="member-avatar" style="background:${m.color}">
        ${avatarContent}
      </div>
      <div class="member-info">
        <div class="member-name">${m.name}</div>
        <div class="member-meta">
          ${m.battery != null ? `<span class="${batClass}">🔋 ${m.battery}%</span>` : ''}
          ${m.recorded_at ? `<span>${timeAgo(new Date(m.recorded_at))}</span>` : ''}
        </div>
        ${m.status ? `<div style="font-size:.75rem;color:var(--text-muted)">${m.status}</div>` : ''}
      </div>`;

    card.addEventListener('click', () => MapModule.focusMember(m.id));
    list.appendChild(card);
  });
}

function updateMemberCard(m) {
  memberData[m.id] = { ...memberData[m.id], ...m };
  renderMemberList();
}

// ── SOS ───────────────────────────────────────────────────────────────────────
function setupSOS() {
  const btn = document.getElementById('sosBtn');
  let holdTimer = null;

  const startHold = () => {
    btn.classList.add('holding');
    holdTimer = setTimeout(async () => {
      const latlng = GeoModule.getCurrentLatLng();
      if (!latlng) { showToast('⚠️ Position non disponible', 'Activez le GPS'); return; }
      try {
        await API.post('/api/notify/sos', { latitude: latlng[0], longitude: latlng[1] });
        showToast('🆘 SOS envoyé', 'Tous les membres ont été alertés', 'sos');
      } catch (err) {
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

// ── Locate ────────────────────────────────────────────────────────────────────
function setupLocate() {
  document.getElementById('locateBtn').addEventListener('click', () => {
    const latlng = GeoModule.getCurrentLatLng();
    if (latlng) {
      MapModule.getMap().setView(latlng, 16, { animate: true });
    } else {
      showToast('⚠️ Position non disponible', 'Activez le GPS');
    }
  });
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
    const interval = parseInt(document.getElementById('gpsInterval').value) || 30;
    localStorage.setItem('ft_interval', interval);
    GeoModule.setInterval(interval);

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

// ── History ───────────────────────────────────────────────────────────────────
function setupHistory() {
  const overlay = document.getElementById('historyOverlay');

  document.getElementById('navHistory').addEventListener('click', async () => {
    // Populate member select
    const sel = document.getElementById('historyMember');
    sel.innerHTML = Object.values(memberData).map((m) =>
      `<option value="${m.id}">${m.name}</option>`
    ).join('');

    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('historyFrom').value = today;
    document.getElementById('historyTo').value   = today;

    overlay.classList.remove('hidden');
    setActiveNav('navHistory');
  });

  document.getElementById('closeHistory').addEventListener('click', () => {
    overlay.classList.add('hidden');
    MapModule.clearTrip();
    setActiveNav('navMap');
  });

  document.getElementById('loadHistory').addEventListener('click', async () => {
    const userId = document.getElementById('historyMember').value;
    const from   = document.getElementById('historyFrom').value;
    const to     = document.getElementById('historyTo').value;

    try {
      const trips = await API.get(`/api/history?userId=${userId}&from=${from}&to=${to}`);
      renderTripList(trips, userId);
    } catch (err) {
      showToast('Erreur', err.message);
    }
  });
}

function renderTripList(trips, userId) {
  const container = document.getElementById('tripList');
  if (!trips.length) {
    container.innerHTML = '<p class="text-muted">Aucun trajet trouvé.</p>';
    return;
  }

  container.innerHTML = trips.map((t, i) => `
    <div class="trip-card" data-index="${i}">
      <div class="trip-header">
        <span>${new Date(t.started_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
        <span>${t.distance_km} km</span>
      </div>
      <div class="trip-meta">
        <span>⏱ ${formatDuration(t.started_at, t.ended_at)}</span>
        <span>⚡ ${t.avg_speed_kmh} km/h moy.</span>
        <span>${t.point_count} pts</span>
      </div>
    </div>`).join('');

  container.querySelectorAll('.trip-card').forEach((card) => {
    card.addEventListener('click', () => {
      const trip = trips[parseInt(card.dataset.index)];
      const color = memberData[userId]?.color || '#3b82f6';
      MapModule.showTrip(trip.points, color);
      document.getElementById('historyOverlay').classList.add('hidden');
    });
    card.addEventListener('dblclick', () => {
      const trip = trips[parseInt(card.dataset.index)];
      const color = memberData[userId]?.color || '#3b82f6';
      MapModule.replayTrip(trip.points, color);
      document.getElementById('historyOverlay').classList.add('hidden');
    });
  });
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
    MapModule.setPickingZone(true);
    setActiveNav('navZones');
  });

  document.getElementById('closeZones').addEventListener('click', () => {
    overlay.classList.add('hidden');
    MapModule.setPickingZone(false);
    setActiveNav('navMap');
  });

  document.getElementById('createZone').addEventListener('click', async () => {
    const name   = document.getElementById('zoneName').value.trim();
    const lat    = parseFloat(document.getElementById('zoneLat').value);
    const lon    = parseFloat(document.getElementById('zoneLon').value);
    const radius = parseInt(document.getElementById('zoneRadius').value);

    if (!name || isNaN(lat) || isNaN(lon) || isNaN(radius)) {
      showToast('Erreur', 'Tous les champs sont requis');
      return;
    }

    try {
      await API.post('/api/zones', { name, latitude: lat, longitude: lon, radius });
      await loadZones();
      renderZoneList();
      document.getElementById('zoneName').value = '';
      showToast('Zone créée', name);
    } catch (err) {
      showToast('Erreur', err.message);
    }
  });
}

function renderZoneList() {
  const container = document.getElementById('zoneList');
  if (!zones.length) {
    container.innerHTML = '<p class="text-muted">Aucune zone définie.</p>';
    return;
  }
  container.innerHTML = zones.map((z) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--border)">
      <div>
        <strong>${z.name}</strong>
        <div class="text-muted">${z.radius} m</div>
      </div>
      <button class="btn btn-danger btn-sm" data-id="${z.id}">Supprimer</button>
    </div>`).join('');

  container.querySelectorAll('[data-id]').forEach((btn) => {
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
}

// ── Admin ──────────────────────────────────────────────────────────────────────
function setupAdmin() {
  const overlay = document.getElementById('adminOverlay');

  document.getElementById('navAdmin')?.addEventListener('click', async () => {
    await renderAdminPanel();
    overlay.classList.remove('hidden');
    setActiveNav('navAdmin');
  });

  document.getElementById('closeAdmin').addEventListener('click', () => {
    overlay.classList.add('hidden');
    setActiveNav('navMap');
  });
}

async function renderAdminPanel() {
  const container = document.getElementById('adminContent');
  container.innerHTML = '<p class="text-muted">Chargement…</p>';

  try {
    const [stats, members, invitations] = await Promise.all([
      API.get('/api/members/stats/global'),
      API.get('/api/members'),
      API.get('/api/auth/invitations'),
    ]);

    container.innerHTML = `
      <div class="admin-section">
        <h4>Statistiques</h4>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-value">${stats.active_members}</div>
            <div class="stat-label">Membres actifs</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(stats.total_positions || 0).toLocaleString('fr-FR')}</div>
            <div class="stat-label">Positions enregistrées</div>
          </div>
        </div>
      </div>

      <div class="admin-section">
        <h4>Membres</h4>
        ${members.map((m) => `
          <div class="admin-member-row">
            <div class="member-avatar" style="width:32px;height:32px;font-size:.8rem;background:${m.color}">
              ${m.avatar_url ? `<img src="${m.avatar_url}" alt="">` : m.name.slice(0, 2).toUpperCase()}
            </div>
            <div class="member-info">
              <div class="member-name">${m.name} <small style="color:var(--text-muted)">${m.role}</small></div>
              <div class="text-muted">${m.email}</div>
            </div>
            <div class="admin-actions">
              ${m.id !== currentUser.id ? `
                <button class="btn btn-ghost btn-sm" data-toggle="${m.id}" data-active="${m.is_active}">
                  ${m.is_active ? 'Désactiver' : 'Activer'}
                </button>` : ''}
            </div>
          </div>`).join('')}
      </div>

      <div class="admin-section">
        <h4>Invitations</h4>
        <button class="btn btn-primary btn-sm" id="genInvite">Générer un lien</button>
        <div id="inviteResult" class="mt-1"></div>
        <div class="mt-2">
          ${invitations.filter((i) => !i.used_by_name).map((i) => `
            <div class="invite-link">${location.origin}/login.html?token=${i.token}</div>
          `).join('') || '<p class="text-muted">Aucune invitation en attente.</p>'}
        </div>
      </div>`;

    // Toggle active
    container.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const newActive = btn.dataset.active === 'true' ? false : true;
        try {
          await API.patch(`/api/members/${btn.dataset.toggle}/activate`, { is_active: newActive });
          await renderAdminPanel();
        } catch (err) {
          showToast('Erreur', err.message);
        }
      });
    });

    // Generate invite
    document.getElementById('genInvite').addEventListener('click', async () => {
      try {
        const { token } = await API.post('/api/auth/invite', {});
        const url = `${location.origin}/login.html?token=${token}`;
        document.getElementById('inviteResult').innerHTML =
          `<div class="invite-link">${url}</div>`;
      } catch (err) {
        showToast('Erreur', err.message);
      }
    });

  } catch (err) {
    container.innerHTML = `<p class="text-danger">Erreur : ${err.message}</p>`;
  }
}

// ── Navigation ─────────────────────────────────────────────────────────────────
function setActiveNav(id) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function setupNavigation() {
  document.getElementById('navMap').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    MapModule.clearTrip();
    setActiveNav('navMap');
  });

  document.getElementById('navMembers').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    setActiveNav('navMembers');
    MapModule.focusAll();
  });

  document.getElementById('closeSidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    setActiveNav('navMap');
  });
}
