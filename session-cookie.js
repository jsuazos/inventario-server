export const SESSION_COOKIE_NAME = 'inventario_session';

export function getCookieValue(cookieHeader = '', name) {
  const prefix = `${name}=`;
  const cookie = String(cookieHeader)
    .split(';')
    .map(value => value.trim())
    .find(value => value.startsWith(prefix));

  if (!cookie) {
    return null;
  }

  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return null;
  }
}

export function getSessionCookieOptions({ secure, maxAgeMs }) {
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    maxAge: maxAgeMs,
    path: '/',
  };
}
