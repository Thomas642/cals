// ════════════════════════════════════════════════════════════════════════════
//  FamilyTracker — History panel (lazy-loaded on first navHistory click)
//
//  Loaded by app.js when the user first opens the Historique tab. Defines
//  the full setupHistory() that wires the panel buttons, then app.js
//  re-fires the original click so the panel opens normally.
//
//  Dependencies (defined in app.js, called as globals from this file) :
//    memberData, MapModule, setActiveNav, showToast, formatDuration,
//    exportGpx, exportGpxGlobal, exportTripsCsv,
//    loadTimeline, loadWeekStats, loadWeeklyTrend, loadRoutines,
//    loadMonthRanking
// ════════════════════════════════════════════════════════════════════════════

function setupHistory() {
  const overlay = document.getElementById('historyOverlay');

  document.getElementById('navHistory').addEventListener('click', async () => {
    const sel = document.getElementById('historyMember');
    sel.innerHTML = Object.values(memberData).map((m) =>
      `<option value="${m.id}">${m.name}</option>`
    ).join('');

    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('historyFrom').value = today;
    document.getElementById('historyTo').value   = today;

    overlay.classList.remove('hidden');
    setActiveNav('navHistory');
    await doLoadHistory();
  });

  document.querySelectorAll('.shortcut-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.shortcut-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const today = new Date();
      const fmt   = (d) => d.toISOString().slice(0, 10);

      if (btn.dataset.shortcut === 'today') {
        document.getElementById('historyFrom').value = fmt(today);
        document.getElementById('historyTo').value   = fmt(today);
      } else if (btn.dataset.shortcut === 'yesterday') {
        const y = new Date(today); y.setDate(y.getDate() - 1);
        document.getElementById('historyFrom').value = fmt(y);
        document.getElementById('historyTo').value   = fmt(y);
      } else if (btn.dataset.shortcut === 'week') {
        const w = new Date(today); w.setDate(w.getDate() - 6);
        document.getElementById('historyFrom').value = fmt(w);
        document.getElementById('historyTo').value   = fmt(today);
      } else if (btn.dataset.shortcut === 'timeline') {
        document.getElementById('timelineContainer').classList.remove('hidden');
        document.getElementById('weekStatsContainer').classList.add('hidden');
        document.getElementById('routinesContainer')?.classList.add('hidden');
        document.getElementById('rankingContainer')?.classList.add('hidden');
        document.getElementById('tripList').innerHTML = '';
        await loadTimeline();
        return;
      } else if (btn.dataset.shortcut === 'stats') {
        document.getElementById('weekStatsContainer').classList.remove('hidden');
        document.getElementById('timelineContainer').classList.add('hidden');
        document.getElementById('routinesContainer')?.classList.add('hidden');
        document.getElementById('rankingContainer')?.classList.add('hidden');
        document.getElementById('tripList').innerHTML = '';
        await loadWeekStats();
        await loadWeeklyTrend();
        return;
      } else if (btn.dataset.shortcut === 'routines') {
        document.getElementById('routinesContainer')?.classList.remove('hidden');
        document.getElementById('weekStatsContainer').classList.add('hidden');
        document.getElementById('timelineContainer').classList.add('hidden');
        document.getElementById('rankingContainer')?.classList.add('hidden');
        document.getElementById('tripList').innerHTML = '';
        await loadRoutines();
        return;
      } else if (btn.dataset.shortcut === 'ranking') {
        document.getElementById('rankingContainer')?.classList.remove('hidden');
        document.getElementById('weekStatsContainer').classList.add('hidden');
        document.getElementById('timelineContainer').classList.add('hidden');
        document.getElementById('routinesContainer')?.classList.add('hidden');
        document.getElementById('tripList').innerHTML = '';
        await loadMonthRanking();
        return;
      }
      document.getElementById('weekStatsContainer').classList.add('hidden');
      document.getElementById('timelineContainer').classList.add('hidden');
      document.getElementById('routinesContainer')?.classList.add('hidden');
      await doLoadHistory();
    });
  });

  document.getElementById('loadHistory').addEventListener('click', doLoadHistory);

  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const userId = document.getElementById('historyMember').value;
    const from   = document.getElementById('historyFrom').value;
    const to     = document.getElementById('historyTo').value;
    const member = Object.values(memberData).find((m) => m.id === userId);
    exportTripsCsv(userId, from, to, member?.name || 'membre');
  });

  document.getElementById('exportGpxGlobalBtn')?.addEventListener('click', () => {
    const userId = document.getElementById('historyMember').value;
    const from   = document.getElementById('historyFrom').value;
    const to     = document.getElementById('historyTo').value;
    const member = Object.values(memberData).find((m) => m.id === userId);
    exportGpxGlobal(userId, from, to, member?.name || 'membre');
  });

  document.getElementById('closeHistory').addEventListener('click', () => {
    overlay.classList.add('hidden');
    try { MapModule.clearTrip(); } catch {}
    setActiveNav('navMap');
  });
}

async function doLoadHistory() {
  const userId = document.getElementById('historyMember').value;
  const from   = document.getElementById('historyFrom').value;
  const to     = document.getElementById('historyTo').value;
  if (!userId) return;

  document.getElementById('weekStatsContainer')?.classList.add('hidden');
  document.getElementById('timelineContainer')?.classList.add('hidden');
  document.getElementById('rankingContainer')?.classList.add('hidden');
  const container = document.getElementById('tripList');
  container.innerHTML = '<p class="text-muted" style="text-align:center;padding:.75rem 0">Chargement…</p>';

  try {
    const trips = await API.get(`/api/history?userId=${userId}&from=${from}&to=${to}`);
    renderTripList(trips, userId);
  } catch (err) {
    showToast('Erreur', err.message);
    container.innerHTML = '';
  }
}

function renderTripList(trips, userId) {
  const container = document.getElementById('tripList');

  if (!trips.length) {
    container.innerHTML = `
      <div class="trip-empty">
        <div style="font-size:2rem">🗺️</div>
        <p>Aucun trajet ce jour</p>
        <small>Les trajets apparaissent après 2 points GPS enregistrés</small>
      </div>`;
    return;
  }

  const totalDist = trips.reduce((s, t) => s + parseFloat(t.distance_km || 0), 0);
  const totalDurMs = trips.reduce((s, t) => s + (new Date(t.ended_at) - new Date(t.started_at)), 0);
  const maxSpeed   = trips.reduce((mx, t) => Math.max(mx, t.max_speed_kmh || t.avg_speed_kmh || 0), 0);

  const fmtTotalDur = (ms) => {
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)}h${m % 60 > 0 ? ` ${m % 60}min` : ''}`;
  };

  container.innerHTML = `
    <div class="trip-summary">
      <div class="trip-summary-item">
        <span class="trip-summary-val">${trips.length}</span>
        <span class="trip-summary-label">trajet${trips.length > 1 ? 's' : ''}</span>
      </div>
      <div class="trip-summary-item">
        <span class="trip-summary-val">${totalDist.toFixed(1)}</span>
        <span class="trip-summary-label">km total</span>
      </div>
      <div class="trip-summary-item">
        <span class="trip-summary-val">${fmtTotalDur(totalDurMs)}</span>
        <span class="trip-summary-label">durée</span>
      </div>
      <div class="trip-summary-item">
        <span class="trip-summary-val">${Math.round(maxSpeed)}</span>
        <span class="trip-summary-label">km/h max</span>
      </div>
    </div>
    <p class="trip-hint-global">Toucher pour voir le trajet · Appui long pour rejouer</p>
    ${trips.map((t, i) => {
      const s = new Date(t.started_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const e = new Date(t.ended_at).toLocaleTimeString('fr-FR',   { hour: '2-digit', minute: '2-digit' });
      const dur = formatDuration(t.started_at, t.ended_at);
      const maxSpd = t.max_speed_kmh || t.avg_speed_kmh || 0;
      return `
        <div class="trip-card" data-index="${i}">
          <div class="trip-header">
            <span class="trip-time">${s} → ${e}</span>
            <div style="display:flex;align-items:center;gap:.4rem">
              <span class="trip-distance">${t.distance_km < 0.1 ? '< 0.1' : t.distance_km} km</span>
              <button class="btn-gpx" data-index="${i}" title="Exporter GPX">⬇️ GPX</button>
            </div>
          </div>
          <div class="trip-meta">
            <span>⏱ ${dur}</span>
            <span>⚡ ${t.avg_speed_kmh} moy.</span>
            ${maxSpd > t.avg_speed_kmh ? `<span>🔺 ${Math.round(maxSpd)} max</span>` : ''}
            <span>📍 ${t.point_count} pts</span>
          </div>
        </div>`;
    }).join('')}`;

  container.querySelectorAll('.btn-gpx').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const trip = trips[parseInt(btn.dataset.index)];
      exportGpx(trip);
    });
  });

  container.querySelectorAll('.trip-card').forEach((card) => {
    let holdTimer = null;
    const trip  = trips[parseInt(card.dataset.index)];
    const color = memberData[userId]?.color || '#3b82f6';

    card.addEventListener('click', () => {
      try { MapModule.showTrip(trip.points, color); } catch {}
      document.getElementById('historyOverlay').classList.add('hidden');
    });
    card.addEventListener('mousedown', () => {
      holdTimer = setTimeout(() => {
        try { MapModule.replayTrip(trip.points, color); } catch {}
        document.getElementById('historyOverlay').classList.add('hidden');
      }, 600);
    });
    card.addEventListener('touchstart', () => {
      holdTimer = setTimeout(() => {
        try { MapModule.replayTrip(trip.points, color); } catch {}
        document.getElementById('historyOverlay').classList.add('hidden');
      }, 600);
    }, { passive: true });
    card.addEventListener('mouseup',   () => clearTimeout(holdTimer));
    card.addEventListener('touchend',  () => clearTimeout(holdTimer));
  });
}
