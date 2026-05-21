/** Resolve a path relative to the Vite base URL (e.g. /edge_ai/). */
export function resolveAssetUrl(path) {
  if (!path || typeof path !== 'string') return path;
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  const base = import.meta.env?.BASE_URL || '/';
  const root = new URL(base, window.location.href);
  return new URL(path.replace(/^\//, ''), root).href;
}
