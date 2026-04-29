// ── Push notification subscription ──────────────────────────────────────────
const PushModule = (() => {
  async function requestPermission() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }

  async function subscribe() {
    const granted = await requestPermission();
    if (!granted) return null;

    const reg = await navigator.serviceWorker.ready;

    const { publicKey } = await API.get('/api/push-key');
    if (!publicKey) return null;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await API.post(`/api/members/${currentUser.id}/push-subscription`, { subscription: sub });
    return sub;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  return { subscribe };
})();

// ── In-app toast notifications ───────────────────────────────────────────────
function showToast(title, body = '', type = '') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div class="toast-title">${title}</div>${body ? `<div class="toast-body">${body}</div>` : ''}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}
