'use strict';
// Shared network guards for every outbound request the app makes.

// No request may hang forever: a stalled API would otherwise hold one of the roster's few lookup
// slots indefinitely and quietly stop the list from ever filling in.
const TIMEOUT_MS = 10000;
const withTimeout = (opts = {}) => ({ ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });

// Endpoints the user configures (Urchin, Connections, admin base) carry API keys in their URL or
// headers, so they must be HTTPS. Plain http is only allowed to this machine, for self-hosted
// trackers - nothing sensitive crosses the network in the clear.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
function isSafeEndpoint(url) {
  let u;
  try { u = new URL(String(url)); } catch (_) { return false; }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname);
}

module.exports = { withTimeout, isSafeEndpoint, TIMEOUT_MS };
