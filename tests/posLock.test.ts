import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import {
  isValidLockPin,
  lockPosWithPin,
  isPosLocked,
  verifyAndUnlockPosPin,
  forceUnlockPos,
} from '../src/lib/posLock.ts';

function installMockStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  (globalThis as any).localStorage = storage;
  (globalThis as any).window = { crypto: webcrypto, localStorage: storage };
  return map;
}

test('isValidLockPin accepts 4 to 6 numeric digits and rejects invalid PINs', () => {
  assert.equal(isValidLockPin('1234'), true);
  assert.equal(isValidLockPin('000000'), true);
  assert.equal(isValidLockPin('123'), false);
  assert.equal(isValidLockPin('1234567'), false);
  assert.equal(isValidLockPin('12ab'), false);
  assert.equal(isValidLockPin(''), false);
});

test('lockPosWithPin stores salted hash (never plaintext PIN), verifies unlock PIN, and clears lock', async () => {
  const rawMap = installMockStorage();
  assert.equal(isPosLocked(), false);

  await lockPosWithPin('2580');
  assert.equal(isPosLocked(), true);

  const storedValues = Array.from(rawMap.values()).join(' ');
  assert.equal(storedValues.includes('2580'), false);

  // Wrong PIN keeps POS locked
  assert.equal(await verifyAndUnlockPosPin('1111'), false);
  assert.equal(isPosLocked(), true);

  // Correct PIN unlocks POS
  assert.equal(await verifyAndUnlockPosPin('2580'), true);
  assert.equal(isPosLocked(), false);
});

test('forceUnlockPos clears active lock state', async () => {
  installMockStorage();
  await lockPosWithPin('4321');
  assert.equal(isPosLocked(), true);

  forceUnlockPos();
  assert.equal(isPosLocked(), false);
});
