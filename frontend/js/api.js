// Thin wrapper around fetch — always attaches JWT, throws on HTTP errors
const API = (() => {
  function token() { return localStorage.getItem('ft_token'); }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token()) headers['Authorization'] = `Bearer ${token()}`;

    const res = await fetch(path, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      localStorage.removeItem('ft_token');
      location.href = '/login.html';
      return;
    }

    const data = res.status === 204 ? null : await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }

  async function upload(path, formData) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token()}` },
      body: formData,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  return {
    get:    (p)      => request('GET', p),
    post:   (p, b)   => request('POST', p, b),
    patch:  (p, b)   => request('PATCH', p, b),
    put:    (p, b)   => request('PUT', p, b),
    delete: (p)      => request('DELETE', p),
    upload,
  };
})();
