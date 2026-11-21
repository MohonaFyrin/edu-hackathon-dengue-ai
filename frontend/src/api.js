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
