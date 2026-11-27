// Tiny fetch wrapper with an in-memory cache: the same request is never sent twice.
const cache = new Map();

export async function api(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null)).toString();
  const url = `/api/${path}${qs ? `?${qs}` : ""}`;
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error?.message || `HTTP ${r.status}`);
        return body;
      }).catch((e) => {
        cache.delete(url); // do not cache failures
        throw e;
      }),
    );
  }
  return cache.get(url);
}

async function parse(r) {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message || `HTTP ${r.status}`);
  return body;
}

/** Uncached GET for data that changes (citizen reports). */
export async function apiFresh(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null)).toString();
  return parse(await fetch(`/api/${path}${qs ? `?${qs}` : ""}`, { cache: "no-store" }));
}

export async function apiPost(path, body) {
  return parse(await fetch(`/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

/** True only when the app's own service answers; navigator.onLine alone is not trusted. */
export async function serviceReachable(ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch("/api/health", { cache: "no-store", signal: ctl.signal });
    return r.ok;
  } catch { return false; } finally { clearTimeout(t); }
}

/** Is the wider internet reachable? Used only to show or hide links that leave the app. */
export async function internetReachable(ms = 4000) {
  if (!navigator.onLine) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    await fetch("https://www.openstreetmap.org/favicon.ico", { mode: "no-cors", cache: "no-store", signal: ctl.signal });
    return true;
  } catch { return false; } finally { clearTimeout(t); }
}
