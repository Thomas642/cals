// ════════════════════════════════════════════════════════════════════════════
//  FamilyTracker — Admin panel module (lazy-loaded on first navAdmin click)
//
//  Loaded dynamically by app.js so that non-admin users (the majority) don't
//  pay the parse cost of these ~390 lines. The bootstrap in app.js calls
//  setupAdmin() once this script has finished executing.
// ════════════════════════════════════════════════════════════════════════════

function setupAdmin() {
  const overlay = document.getElementById('adminOverlay');

  document.getElementById('navAdmin')?.addEventListener('click', async () => {
    await renderAdminPanel();
    overlay.classList.remove('hidden');
    setActiveNav('navAdmin');
    clearBadge('admin');
  });

  document.getElementById('closeAdmin').addEventListener('click', () => {
    overlay.classList.add('hidden');
    setActiveNav('navMap');
  });

  setupAdminTools();
}

// ── Advanced admin tools (health / audit / limits) ──────────────────────────
let _healthRefreshTimer = null;

function setupAdminTools() {
  const toolsOverlay = document.getElementById('adminToolsOverlay');
  if (!toolsOverlay) return;

  document.getElementById('openAdminTools')?.addEventListener('click', () => {
    toolsOverlay.classList.remove('hidden');
    switchTab('health');
  });

  document.getElementById('closeAdminTools')?.addEventListener('click', () => {
    toolsOverlay.classList.add('hidden');
    if (_healthRefreshTimer) { clearInterval(_healthRefreshTimer); _healthRefreshTimer = null; }
  });

  document.querySelectorAll('.tools-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  document.querySelectorAll('.tools-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tools-pane').forEach((p) => p.classList.toggle('hidden', p.id !== `tools-${name}`));
  if (_healthRefreshTimer) { clearInterval(_healthRefreshTimer); _healthRefreshTimer = null; }
  if (name === 'health') {
    loadHealth();
    _healthRefreshTimer = setInterval(loadHealth, 15_000);
  } else if (name === 'audit') {
    loadAudit();
  } else if (name === 'limits') {
    loadLimits();
  }
}

async function loadHealth() {
  const body = document.getElementById('healthBody');
  try {
    const h = await API.get('/api/admin/health');
    const dbColor    = h.db.status === 'ok' ? '#10b981' : '#ef4444';
    const osrmColor  = h.osrm.status === 'ok' ? '#10b981' : '#f59e0b';
    const diskPct    = parseInt(h.disk?.use_pct) || 0;
    const diskColor  = diskPct < 70 ? '#10b981' : diskPct < 90 ? '#f59e0b' : '#ef4444';
    const upHours    = Math.floor(h.uptime_s / 3600);
    const upMin      = Math.floor((h.uptime_s % 3600) / 60);
    body.innerHTML = `
      <div class="health-grid">
        <div class="health-card"><b style="color:${dbColor}">●</b> Base de données<br><span class="text-muted">${h.db.status}${h.db.size ? ` · ${h.db.size}` : ''}</span></div>
        <div class="health-card"><b style="color:${osrmColor}">●</b> OSRM Routing<br><span class="text-muted">${h.osrm.status}</span></div>
        <div class="health-card"><b style="color:${diskColor}">●</b> Disque<br><span class="text-muted">${h.disk ? `${h.disk.used}/${h.disk.size} (${h.disk.use_pct})` : '—'}</span></div>
        <div class="health-card">⏱️ Uptime<br><span class="text-muted">${upHours}h ${upMin}min</span></div>
        <div class="health-card">🧠 Mémoire<br><span class="text-muted">${h.memory.rss_mb} MB RSS</span></div>
        <div class="health-card">📥 Positions 24h<br><span class="text-muted">${h.counts.positions_24h}</span></div>
      </div>
      <hr style="border-color:var(--border);margin:1rem 0">
      <div style="font-size:.82rem;line-height:1.7">
        <div>👥 Membres actifs : <b>${h.counts.users}</b></div>
        <div>📍 Positions total : <b>${h.counts.positions.toLocaleString('fr-FR')}</b></div>
        <div>💬 Messages chat : <b>${h.counts.messages.toLocaleString('fr-FR')}</b></div>
        <div>🚧 Zones actives : <b>${h.counts.zones}</b></div>
        <div>🔗 Liens partage actifs : <b>${h.counts.active_shares}</b></div>
      </div>
      <p class="text-muted" style="margin-top:.5rem;font-size:.72rem">Auto-refresh 15s · ${new Date(h.timestamp).toLocaleTimeString('fr-FR')}</p>`;
  } catch (err) {
    body.innerHTML = `<p style="color:#ef4444">Erreur : ${err.message}</p>`;
  }
}

async function loadAudit() {
  const body = document.getElementById('auditBody');
  try {
    const events = await API.get('/api/admin/audit?limit=100');
    if (!events.length) {
      body.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📜</div>
          <div class="empty-state-title">Pas d'événement d'audit</div>
          <div class="empty-state-body">Les actions admin (invitations, suppressions, changements de limites) s'afficheront ici.</div>
        </div>`;
      return;
    }
    body.innerHTML = `
      <div style="max-height:55vh;overflow-y:auto">
      ${events.map((e) => `
        <div style="padding:.5rem;border-bottom:1px solid var(--border);font-size:.82rem">
          <div><b>${e.action}</b> <span class="text-muted">par ${e.actor_name || '—'}</span></div>
          ${e.target_name ? `<div class="text-muted" style="font-size:.75rem">cible : ${e.target_name}</div>` : ''}
          ${e.details && Object.keys(e.details).length ? `<code style="font-size:.7rem;color:var(--text-muted)">${adminEscapeHtml(JSON.stringify(e.details))}</code>` : ''}
          <div class="text-muted" style="font-size:.7rem">${new Date(e.created_at).toLocaleString('fr-FR')}</div>
        </div>`).join('')}
      </div>`;
  } catch (err) {
    body.innerHTML = `<p style="color:#ef4444">Erreur : ${err.message}</p>`;
  }
}

async function loadLimits() {
  const body = document.getElementById('limitsBody');
  try {
    const members = await API.get('/api/members');
    body.innerHTML = members.map((m) => `
      <div style="display:flex;align-items:center;gap:.4rem;padding:.5rem 0;border-bottom:1px solid var(--border)">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${m.color}"></span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.85rem">${m.name}</div>
          <div class="text-muted" style="font-size:.72rem">${m.email}</div>
        </div>
        <input type="number" min="0" placeholder="∞" value="${m.rate_limit_positions_day ?? ''}"
          data-uid="${m.id}" data-kind="pos" style="width:70px;padding:.3rem;font-size:.78rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text)" title="Positions / jour">
        <input type="number" min="0" placeholder="∞" value="${m.rate_limit_messages_day ?? ''}"
          data-uid="${m.id}" data-kind="msg" style="width:70px;padding:.3rem;font-size:.78rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text)" title="Messages / jour">
        <button class="btn btn-primary btn-sm save-limit" data-uid="${m.id}">💾</button>
      </div>
    `).join('');

    body.querySelectorAll('.save-limit').forEach((btn) => {
      btn.onclick = async () => {
        const uid = btn.dataset.uid;
        const pos = body.querySelector(`input[data-uid="${uid}"][data-kind="pos"]`).value.trim();
        const msg = body.querySelector(`input[data-uid="${uid}"][data-kind="msg"]`).value.trim();
        try {
          await API.put(`/api/admin/limits/${uid}`, {
            positions_per_day: pos === '' ? null : parseInt(pos),
            messages_per_day:  msg === '' ? null : parseInt(msg),
          });
          showToast('Limites mises à jour', '');
        } catch (err) {
          showToast('Erreur', err.message);
        }
      };
    });
  } catch (err) {
    body.innerHTML = `<p style="color:#ef4444">Erreur : ${err.message}</p>`;
  }
}

function adminEscapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

async function renderAdminPanel() {
  const container = document.getElementById('adminContent');
  // Skeleton placeholders while the admin data loads in parallel
  container.innerHTML = `
    <div class="skeleton skeleton-line" style="width:30%"></div>
    <div class="skeleton-row"><div class="skeleton skeleton-avatar"></div><div class="skeleton-body"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div></div>
    <div class="skeleton-row"><div class="skeleton skeleton-avatar"></div><div class="skeleton-body"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div></div>
    <div class="skeleton-row"><div class="skeleton skeleton-avatar"></div><div class="skeleton-body"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div></div>`;

  try {
    const [stats, members, invitations, sosHistory, msgHistory, monthStats] = await Promise.all([
      API.get('/api/members/stats/global'),
      API.get('/api/members'),
      API.get('/api/auth/invitations'),
      API.get('/api/notify/history?type=sos&limit=5').catch(() => []),
      API.get('/api/notify/history?type=quick_message&limit=5').catch(() => []),
      API.get('/api/history/stats/month').catch(() => []),
    ]);

    const totalDistKm = (stats.top_members || []).reduce((s, m) => s + parseFloat(m.distance_km || 0), 0);

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
            <div class="stat-label">Points GPS enregistrés</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${totalDistKm.toFixed(0)}</div>
            <div class="stat-label">km parcourus (total)</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${invitations.filter((i) => !i.used_by_name).length}</div>
            <div class="stat-label">Invitations actives</div>
          </div>
        </div>
      </div>

      ${(stats.top_members || []).length > 0 ? `
      <div class="admin-section">
        <h4>Distance parcourue par membre</h4>
        ${stats.top_members.map((m, i) => {
          const maxDist = stats.top_members[0].distance_km || 1;
          const pct = Math.round((m.distance_km / maxDist) * 100);
          return `
          <div class="admin-distance-row">
            <div class="admin-dist-label">
              <span>${i + 1 === 1 ? '🥇' : i + 1 === 2 ? '🥈' : i + 1 === 3 ? '🥉' : '▸'} ${m.name}</span>
              <span class="admin-dist-val">${parseFloat(m.distance_km).toFixed(1)} km</span>
            </div>
            <div class="admin-dist-bar-outer">
              <div class="admin-dist-bar-inner" style="width:${pct}%"></div>
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}

      ${monthStats.length > 0 ? `
      <div class="admin-section">
        <h4>📅 Bilan du mois (30 jours)</h4>
        <div class="month-stats-table">
          <div class="month-stats-head">
            <span>Membre</span><span>km</span><span>Jours</span><span>Conduite</span><span>Max</span>
          </div>
          ${monthStats.map((r) => `
          <div class="month-stats-row">
            <span style="color:${r.color};font-weight:700">${r.name}</span>
            <span>${r.distance_km}</span>
            <span>${r.active_days}</span>
            <span>${r.driving_km} km</span>
            <span>${r.max_speed_kmh} km/h</span>
          </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="admin-section">
        <h4>Membres</h4>
        ${members.map((m) => {
          const livePos = memberData[m.id];
          const ageSec = livePos?.recorded_at ? (Date.now() - new Date(livePos.recorded_at)) / 1000 : null;
          const statusDot = ageSec == null ? 'offline' : ageSec < 120 ? '' : ageSec < 600 ? 'away' : 'offline';
          const lastSeen = ageSec != null ? timeAgo(new Date(livePos.recorded_at)) : 'Jamais';
          return `
          <div class="admin-member-row">
            <div class="member-avatar-wrap" style="flex-shrink:0">
              <div class="member-avatar" style="width:36px;height:36px;font-size:.82rem;background:${m.color}">
                ${m.avatar_url ? `<img src="${m.avatar_url}" alt="">` : m.name.slice(0, 2).toUpperCase()}
              </div>
              <span class="member-online-dot ${statusDot}"></span>
            </div>
            <div class="member-info">
              <div class="member-name">
                ${m.name}
                <span class="admin-role-badge admin-role-${m.role}">${m.role}</span>
              </div>
              <div class="text-muted" style="font-size:.73rem">${m.email}</div>
              <div class="text-muted" style="font-size:.71rem;margin-top:.1rem">Vu : ${lastSeen}${livePos?.battery != null ? ` · 🔋${livePos.battery}%` : ''}</div>
            </div>
            <div class="admin-actions">
              ${m.id !== currentUser.id ? `
                <button class="btn btn-ghost btn-sm" data-toggle="${m.id}" data-active="${m.is_active}">
                  ${m.is_active ? 'Désactiver' : 'Activer'}
                </button>` : '<span class="text-muted" style="font-size:.75rem">Vous</span>'}
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="admin-section">
        <h4>Derniers SOS</h4>
        ${sosHistory.length === 0
          ? '<p class="text-muted" style="font-size:.82rem">Aucun SOS enregistré. ✅</p>'
          : sosHistory.map((e) => {
              const p = e.payload || {};
              const when = new Date(e.sent_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
              return `<div class="admin-event-row">
                <span class="admin-event-icon">🆘</span>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:700;font-size:.85rem">${e.sender_name || 'Inconnu'}</div>
                  <div class="text-muted" style="font-size:.72rem">${when}${p.latitude ? ` · ${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}` : ''}</div>
                </div>
                ${p.latitude ? `<button class="btn btn-ghost btn-sm" data-lat="${p.latitude}" data-lon="${p.longitude}">📍</button>` : ''}
              </div>`;
            }).join('')
        }
      </div>

      <div class="admin-section">
        <h4>Derniers messages</h4>
        ${msgHistory.length === 0
          ? '<p class="text-muted" style="font-size:.82rem">Aucun message envoyé.</p>'
          : msgHistory.map((e) => {
              const p = e.payload || {};
              const when = new Date(e.sent_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
              return `<div class="admin-event-row">
                <span class="admin-event-icon">💬</span>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:600;font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.text || ''}</div>
                  <div class="text-muted" style="font-size:.72rem">${e.sender_name || 'Inconnu'} · ${when}</div>
                </div>
              </div>`;
            }).join('')
        }
      </div>

      <div class="admin-section">
        <h4>Invitations</h4>
        <button class="btn btn-primary btn-sm" id="genInvite">Générer un lien</button>
        <div id="inviteResult" class="mt-1"></div>
        <div class="mt-1">
          ${invitations.filter((i) => !i.used_by_name).map((i) => `
            <div class="invite-link">${location.origin}/login.html?token=${i.token}</div>
          `).join('') || '<p class="text-muted" style="font-size:.82rem">Aucune invitation en attente.</p>'}
        </div>
      </div>

      <div class="admin-section">
        <h4>👤 Accès invité temporaire</h4>
        <p class="text-muted" style="font-size:.82rem;margin-bottom:.75rem">Crée un lien magique sans mot de passe. L'accès expire automatiquement.</p>
        <div class="form-group">
          <label>Nom de l'invité</label>
          <input type="text" id="guestName" placeholder="ex : Mamie, Babysitter…" maxlength="50">
        </div>
        <div class="form-group">
          <label>Durée (heures, max 168)</label>
          <input type="number" id="guestDuration" value="24" min="1" max="168">
        </div>
        <button class="btn btn-ghost btn-sm" id="genGuestLink">Créer accès invité</button>
        <div id="guestLinkResult" class="mt-1"></div>
      </div>`;

    // Locate SOS on map
    container.querySelectorAll('[data-lat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('adminOverlay').classList.add('hidden');
        try { MapModule.getMap().setView([parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lon)], 16); } catch {}
        setActiveNav('navMap');
      });
    });

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

    // Guest invite
    document.getElementById('genGuestLink')?.addEventListener('click', async () => {
      const name = document.getElementById('guestName').value.trim();
      const duration_hours = parseInt(document.getElementById('guestDuration').value) || 24;
      if (!name) { showToast('⚠️ Nom requis', ''); return; }
      try {
        const { url, expires_at } = await API.post('/api/auth/guest-invite', { name, duration_hours });
        const expiresStr = new Date(expires_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        document.getElementById('guestLinkResult').innerHTML = `
          <div class="invite-link">${url}</div>
          <div style="font-size:.72rem;color:var(--text-muted);margin-top:.3rem">Expire le ${expiresStr}</div>
          <button class="btn btn-ghost btn-sm mt-1" onclick="navigator.clipboard.writeText('${adminEscapeHtml(url)}');showToast('✅ Copié','')">Copier le lien</button>`;
        document.getElementById('guestName').value = '';
        showToast(`👤 Accès créé pour ${name}`, `Expire dans ${duration_hours}h`, 'ok');
      } catch (err) {
        showToast('Erreur', err.message);
      }
    });

  } catch (err) {
    container.innerHTML = `<p class="text-danger">Erreur : ${err.message}</p>`;
  }
}

// Signal to the lazy-loader that we're ready
if (typeof window._adminReady === 'function') window._adminReady();
