// ════════════════════════════════════════════════════════════════════════════
//  FamilyTracker — Chat module (lazy-loaded on first navChat click)
//
//  Loaded by app.js when the user first opens the Chat panel. Defines the
//  full chat UI : load history, send/receive messages, reactions, emoji
//  picker, long-press to delete.
//
//  Dependencies (defined in app.js, called as globals from this file) :
//    API, socket, currentUser, showToast, setActiveNav
//  Stubs in app.js are overridden once this script loads :
//    setupChat, setupChatReactions, setupChatOpen, appendChatMessage,
//    scrollChatToBottom
// ════════════════════════════════════════════════════════════════════════════

let _chatHistoryLoaded = false;

function setupChat() {
  const overlay = document.getElementById('chatOverlay');
  const input   = document.getElementById('chatInput');

  document.getElementById('closeChat').addEventListener('click', () => {
    overlay.classList.add('hidden');
    setActiveNav('navMap');
  });

  // Close on overlay backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.add('hidden');
      setActiveNav('navMap');
    }
  });

  document.getElementById('chatSend').addEventListener('click', sendChatMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });
}

async function setupChatOpen() {
  const overlay = document.getElementById('chatOverlay');
  overlay.classList.remove('hidden');
  setActiveNav('navChat');

  if (!_chatHistoryLoaded) {
    await loadChatHistory();
    _chatHistoryLoaded = true;
  }
  scrollChatToBottom();
  setTimeout(() => document.getElementById('chatInput').focus(), 200);
}

async function loadChatHistory() {
  const container = document.getElementById('chatMessages');
  container.innerHTML = '<div class="chat-loading">Chargement…</div>';
  try {
    const messages = await API.get('/api/chat?limit=50');
    container.innerHTML = '';
    if (!messages.length) {
      container.innerHTML = '<div class="chat-empty">Aucun message. Soyez le premier ! 👋</div>';
      return;
    }
    messages.forEach((m) => appendChatMessage(m));
    scrollChatToBottom();
  } catch (err) {
    container.innerHTML = `<div class="chat-empty text-danger">Erreur : ${err.message}</div>`;
  }
}

function appendChatMessage(msg) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  const isMine = msg.user_id === currentUser?.id;
  const time   = new Date(msg.sent_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const initials = msg.name ? msg.name.slice(0, 2).toUpperCase() : '?';
  const avatarContent = msg.avatar_url
    ? `<img src="${msg.avatar_url}" alt="${msg.name}">`
    : initials;

  // Check if we should group with previous message (same user, within 3 min)
  const lastBubble = container.querySelector('.chat-bubble-wrap:last-child');
  const lastUserId = lastBubble?.dataset.userId;
  const lastTime   = parseInt(lastBubble?.dataset.time || 0);
  const grouped    = lastUserId === msg.user_id && (new Date(msg.sent_at) - lastTime) < 180_000;

  const wrap = document.createElement('div');
  wrap.className = `chat-bubble-wrap ${isMine ? 'mine' : 'theirs'}`;
  wrap.dataset.userId = msg.user_id;
  wrap.dataset.time   = new Date(msg.sent_at).getTime();
  wrap.dataset.msgId  = msg.id;

  const reactionsHtml = (msg.reactions && msg.reactions.length)
    ? `<div class="chat-reactions">${groupReactions(msg.reactions).map(r =>
        `<button class="reaction-chip${r.users.includes(currentUser?.id) ? ' mine' : ''}" data-msg="${msg.id}" data-emoji="${r.emoji}">${r.emoji} ${r.count}</button>`
      ).join('')}</div>`
    : `<div class="chat-reactions" data-msg-reactions="${msg.id}"></div>`;

  wrap.innerHTML = `
    ${!isMine && !grouped ? `
      <div class="chat-avatar" style="background:${msg.color}">${avatarContent}</div>
    ` : `<div class="chat-avatar-spacer"></div>`}
    <div class="chat-bubble-col">
      ${!isMine && !grouped ? `<div class="chat-sender">${msg.name}</div>` : ''}
      <div class="chat-bubble" data-bubble-id="${msg.id}">
        <span class="chat-text">${escapeHtml(msg.text)}</span>
        <span class="chat-time">${time}</span>
      </div>
      ${reactionsHtml}
    </div>`;

  // Long-press to delete own messages or open emoji picker for others
  let holdTimer = null;
  const bubble = wrap.querySelector('.chat-bubble');
  if (isMine) {
    wrap.addEventListener('mousedown',  () => { holdTimer = setTimeout(() => confirmDeleteMsg(msg.id, wrap), 600); });
    wrap.addEventListener('touchstart', () => { holdTimer = setTimeout(() => confirmDeleteMsg(msg.id, wrap), 600); }, { passive: true });
    wrap.addEventListener('mouseup',    () => clearTimeout(holdTimer));
    wrap.addEventListener('touchend',   () => clearTimeout(holdTimer));
  } else {
    bubble.addEventListener('mousedown',  () => { holdTimer = setTimeout(() => showEmojiPicker(msg.id, bubble), 600); });
    bubble.addEventListener('touchstart', () => { holdTimer = setTimeout(() => showEmojiPicker(msg.id, bubble), 600); }, { passive: true });
    bubble.addEventListener('mouseup',    () => clearTimeout(holdTimer));
    bubble.addEventListener('touchend',   () => clearTimeout(holdTimer));
  }

  // Reaction chip clicks
  wrap.querySelectorAll('.reaction-chip').forEach((chip) => {
    chip.addEventListener('click', () => toggleReaction(msg.id, chip.dataset.emoji));
  });

  container.appendChild(wrap);
}

async function confirmDeleteMsg(id, el) {
  if (!confirm('Supprimer ce message ?')) return;
  try {
    await API.delete(`/api/chat/${id}`);
    el.remove();
  } catch (err) {
    showToast('Erreur', err.message);
  }
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const text  = input.value.trim();
  if (!text) return;

  input.value    = '';
  input.disabled = true;

  try {
    const msg = await API.post('/api/chat', { text });
    appendChatMessage(msg);
    scrollChatToBottom();
  } catch (err) {
    showToast('Erreur', err.message);
    input.value = text;
  } finally {
    input.disabled = false;
    input.focus();
  }
}

function scrollChatToBottom(smooth = false) {
  const container = document.getElementById('chatMessages');
  if (container) container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

// ── Chat reactions helpers ──────────────────────────────────────────────────
function groupReactions(reactions) {
  const map = new Map();
  for (const r of reactions) {
    if (!map.has(r.emoji)) map.set(r.emoji, { emoji: r.emoji, count: 0, users: [] });
    const entry = map.get(r.emoji);
    entry.count++;
    if (r.user_id) entry.users.push(r.user_id);
  }
  return Array.from(map.values());
}

const EMOJI_PICKER_LIST = ['👍','❤️','😂','😮','😢','🙏'];

function showEmojiPicker(msgId, anchor) {
  // Remove any existing picker
  document.querySelector('.emoji-picker')?.remove();

  const picker = document.createElement('div');
  picker.className = 'emoji-picker';
  EMOJI_PICKER_LIST.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.className = 'emoji-picker-btn';
    btn.textContent = emoji;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      picker.remove();
      toggleReaction(msgId, emoji);
    });
    picker.appendChild(btn);
  });

  anchor.style.position = 'relative';
  anchor.appendChild(picker);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', () => picker.remove(), { once: true });
  }, 0);
}

async function toggleReaction(msgId, emoji) {
  try {
    // Check if user already reacted with this emoji
    const wrap = document.querySelector(`[data-msg-id="${msgId}"]`);
    const chip = wrap?.querySelector(`.reaction-chip[data-emoji="${emoji}"]`);
    const isMine = chip?.classList.contains('mine');

    if (isMine) {
      await API.delete(`/api/chat/${msgId}/react`);
    } else {
      await API.post(`/api/chat/${msgId}/react`, { emoji });
    }
    await refreshMessageReactions(msgId);
  } catch (err) {
    showToast('Erreur', err.message);
  }
}

async function refreshMessageReactions(msgId) {
  try {
    const wrap = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (!wrap) return;
    const allMsgs = await API.get('/api/chat?limit=50');
    const msg = allMsgs.find((m) => m.id === msgId);
    if (!msg) return;
    const reactionsDiv = wrap.querySelector('.chat-reactions');
    if (!reactionsDiv) return;
    const grouped = groupReactions(msg.reactions || []);
    reactionsDiv.innerHTML = grouped.map(r =>
      `<button class="reaction-chip${r.users.includes(currentUser?.id) ? ' mine' : ''}" data-msg="${msgId}" data-emoji="${r.emoji}">${r.emoji} ${r.count}</button>`
    ).join('');
    reactionsDiv.querySelectorAll('.reaction-chip').forEach((chip) => {
      chip.addEventListener('click', () => toggleReaction(msgId, chip.dataset.emoji));
    });
  } catch {}
}

function setupChatReactions() {
  if (!socket) return;
  socket.on('chat_reaction', async (data) => {
    if (data.message_id) {
      await refreshMessageReactions(data.message_id);
    }
  });
}
