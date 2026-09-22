import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tyreZone } from '../web/tyre-color.js';

test('tyreZone buckets temperatures into cold, optimal, hot and overheating', () => {
  assert.equal(tyreZone(20), 'cold');
  assert.equal(tyreZone(69.9), 'cold');
  assert.equal(tyreZone(70), 'optimal');
  assert.equal(tyreZone(80), 'optimal');
  assert.equal(tyreZone(89.9), 'optimal');
  assert.equal(tyreZone(90), 'hot');
  assert.equal(tyreZone(104.9), 'hot');
  assert.equal(tyreZone(105), 'overheating');
  assert.equal(tyreZone(200), 'overheating');
});

test('tyreZone returns null for missing or non-finite readings', () => {
  for (const bad of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(tyreZone(bad), null, String(bad));
  }
});
