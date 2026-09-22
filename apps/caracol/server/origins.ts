/** Origens permitidas pelo CORS do Socket.IO. */
export function parseAllowedOrigins(value: string | undefined): Array<string | RegExp> | true {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (entries.length === 0) return true;
  return entries.map((entry) => (entry.includes('*') ? wildcardToRegExp(entry) : entry));
}

export function isOriginAllowed(allowed: Array<string | RegExp> | true, origin: string): boolean {
  if (allowed === true) return true;
  return allowed.some((entry) => (typeof entry === 'string' ? entry === origin : entry.test(origin)));
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '[^.]*');
  return new RegExp(`^${escaped}$`);
}
