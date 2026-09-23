import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldNotifyForInventoryChange } from '../change-detector.js';

test('no notifica al inicializar el estado de sincronización', () => {
  assert.equal(shouldNotifyForInventoryChange(null, 1_700_000_000_000), false);
});

test('notifica cuando hay un cambio más reciente', () => {
  assert.equal(shouldNotifyForInventoryChange('1700000000000', 1_700_000_000_001), true);
});

test('no notifica si no hay cambios nuevos', () => {
  assert.equal(shouldNotifyForInventoryChange('1700000000000', 1_700_000_000_000), false);
});
