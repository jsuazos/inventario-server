import assert from 'node:assert/strict';
import test from 'node:test';
import { ExpiringCache } from '../external-service.js';

test('reutiliza la respuesta mientras la caché está vigente', async () => {
  let now = 1_000;
  let loads = 0;
  const cache = new ExpiringCache({ ttlMs: 500, now: () => now });
  const loader = async () => ({ value: ++loads });

  const first = await cache.getOrLoad('discogs:1', loader);
  const second = await cache.getOrLoad('discogs:1', loader);

  assert.deepEqual(first, { data: { value: 1 }, cached: false });
  assert.deepEqual(second, { data: { value: 1 }, cached: true });

  now += 500;
  const expired = await cache.getOrLoad('discogs:1', loader);
  assert.deepEqual(expired, { data: { value: 2 }, cached: false });
});

test('limita el número de entradas guardadas', async () => {
  const cache = new ExpiringCache({ ttlMs: 1_000, maxEntries: 2 });

  await cache.getOrLoad('uno', async () => 1);
  await cache.getOrLoad('dos', async () => 2);
  await cache.getOrLoad('tres', async () => 3);

  assert.equal(cache.values.has('uno'), false);
  assert.equal(cache.values.size, 2);
});
