import assert from 'node:assert/strict';
import test from 'node:test';
import { createRateLimiter } from '../rate-limit.js';

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    set(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    once() {},
  };
}

test('bloquea un intento cuando supera el límite configurado', () => {
  const limiter = createRateLimiter({
    windowMs: 60_000,
    maxAttempts: 2,
    keyGenerator: req => req.ip,
  });
  let nextCalls = 0;

  limiter({ ip: '127.0.0.1' }, createResponse(), () => { nextCalls++; });
  limiter({ ip: '127.0.0.1' }, createResponse(), () => { nextCalls++; });

  const blockedResponse = createResponse();
  limiter({ ip: '127.0.0.1' }, blockedResponse, () => { nextCalls++; });

  assert.equal(nextCalls, 2);
  assert.equal(blockedResponse.statusCode, 429);
  assert.ok(blockedResponse.headers['Retry-After']);
});
