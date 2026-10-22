// Thin wrapper around fetch for the Featherkeeper API.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? `Request failed (HTTP ${status})`);
    this.status = status;
    this.code = body?.error ?? null;
  }
}

// The demo build (VITE_DEMO=true) answers from an in-memory fake; real builds never include it.
const DEMO = import.meta.env.VITE_DEMO === 'true';

async function request(method, url, body) {
  if (DEMO) {
    const { demoRequest } = await import('./demo/server.js');
    try {
      return await demoRequest(method, url, body);
    } catch (err) {
      throw new ApiError(err.status ?? 500, { message: err.message });
    }
  }
  const options = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${url}`, options);
  } catch {
    throw new ApiError(0, { message: 'Could not reach the server. Check your connection and try again.' });
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
  upload(url, file) {
    const form = new FormData();
    form.append('file', file);
    return request('POST', url, form);
  },
};
