import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

function installIdbAndCryptoMocks() {
  const stores: Record<string, Map<string, any>> = {
    terminal_config: new Map(),
    offline_sales_queue: new Map(),
    local_sequence: new Map(),
  };

  const makeTransaction = (storeNames: string | string[]) => {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    let finished = false;
    let pendingRequests = 0;

    const tx: any = {
      oncomplete: null as null | (() => void),
      onerror: null as null | (() => void),
      error: null,
      objectStore: (name: string) => {
        if (!names.includes(name)) {
          throw new Error(`Store ${name} not in transaction`);
        }
        const map = stores[name];
        const enqueueOp = (op: () => any) => {
          if (finished) {
            throw new Error("Failed to execute 'put' on 'IDBObjectStore': The transaction has finished.");
          }
          pendingRequests += 1;
          const req: any = { result: undefined, error: null, onsuccess: null, onerror: null };
          queueMicrotask(() => {
            try {
              req.result = op();
              req.onsuccess?.({ target: req });
            } catch (err) {
              req.error = err;
              tx.error = err;
              req.onerror?.({ target: req });
            } finally {
              pendingRequests -= 1;
              if (pendingRequests === 0) {
                finished = true;
                tx.oncomplete?.();
              }
            }
          });
          return req;
        };

        return {
          get: (key: string) => enqueueOp(() => map.get(key)),
          getAll: () => enqueueOp(() => Array.from(map.values())),
          put: (val: any, key?: string) =>
            enqueueOp(() => {
              const k = key ?? val.id;
              map.set(k, val);
              return k;
            }),
          delete: (key: string) =>
            enqueueOp(() => {
              map.delete(key);
              return undefined;
            }),
        };
      },
    };

    return tx;
  };

  const mockDb = {
    objectStoreNames: { contains: (n: string) => n in stores },
    transaction: (storeNames: string | string[]) => makeTransaction(storeNames),
  };

  (globalThis as any).window = { crypto: webcrypto };
  (globalThis as any).indexedDB = {
    open: () => {
      const req: any = { result: mockDb, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };

  return stores;
}

test('saveTerminalConfig generates crypto_key outside IDB transaction without hitting finished-transaction error', async () => {
  const stores = installIdbAndCryptoMocks();
  const { saveTerminalConfig, getTerminalConfig } = await import('../src/lib/offlineService.ts');

  const hexKey = await saveTerminalConfig({
    branch_id: 'branch-1',
    branch_name: 'Handaan',
    terminal_code: 'T02',
    name: 'Tab1',
  });

  assert.equal(hexKey.length, 64);
  assert.ok(stores.terminal_config.get('crypto_key'));
  const saved = await getTerminalConfig();
  assert.equal(saved?.terminal_code, 'T02');
  assert.equal(saved?.branch_name, 'Handaan');
});
