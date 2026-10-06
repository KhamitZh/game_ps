const fromEnv = import.meta.env.VITE_SERVER_URL?.trim();

/** In dev, the Worker runs on the same host at port 8787 (works for phones on the LAN too). */
export const SERVER_URL = (fromEnv || `${location.protocol}//${location.hostname}:8787`).replace(/\/+$/, '');

export function wsUrl(pin: string): string {
  return `${SERVER_URL.replace(/^http/, 'ws')}/ws/${pin}`;
}
