// Redirect to login if not authenticated
(function () {
  if (!localStorage.getItem('ft_token')) {
    location.href = '/login.html';
  }
})();

let currentUser = null;

async function loadCurrentUser() {
  try {
    currentUser = await API.get('/api/auth/me');
    return currentUser;
  } catch {
    localStorage.removeItem('ft_token');
    location.href = '/login.html';
  }
}
