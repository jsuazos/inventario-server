import assert from 'node:assert/strict';
import test from 'node:test';
import { getCookieValue, getSessionCookieOptions, SESSION_COOKIE_NAME } from '../session-cookie.js';

test('lee la cookie de sesión sin depender del orden', () => {
  const header = 'tema=oscuro; inventario_session=token%2Eseguro; idioma=es';
  assert.equal(getCookieValue(header, SESSION_COOKIE_NAME), 'token.seguro');
});

test('configura cookies seguras para producción y lax para desarrollo', () => {
  assert.deepEqual(getSessionCookieOptions({ secure: true, maxAgeMs: 1000 }), {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 1000,
    path: '/',
  });
  assert.equal(getSessionCookieOptions({ secure: false, maxAgeMs: 1000 }).sameSite, 'lax');
});
