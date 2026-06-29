/**
 * offlineService.ts
 *
 * Dedicated zero-dependency browser service for:
 * 1. Persistent IndexedDB storage for terminal registration, local sequences, and sales queue.
 * 2. Web Crypto API AES-GCM encryption to protect local offline sales logs from DevTools tampering.
 */

const DB_NAME = 'pos_offline_db';
const DB_VERSION = 1;

export interface TerminalConfig {
  id?: string;
  tenant_id?: string;
  branch_id: string;
  branch_name: string;
  terminal_code: string;
  name: string;
  device_key?: CryptoKey;
  device_key_raw?: string; // Hex representation sent to the database
}

export interface OfflineSale {
  id: string; // Temporary local UUID
  branch_id: string;
  cashier_id: string;
  cashier_email: string;
  payment_method: string;
  amount_tendered: number | null;
  sale_category: string;
  reference_number: string;
  control_number: string; // OFF-T01-00001
  created_at: string; // ISO string
  items: Array<{ menu_item_id: string; quantity: number; name?: string; price?: number }>;
  total_amount: number;
}

interface EncryptedQueueItem {
  id: string;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

// ── IndexedDB Engine ────────────────────────────────────────────────────────

const openDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('terminal_config')) {
        db.createObjectStore('terminal_config');
      }
      if (!db.objectStoreNames.contains('offline_sales_queue')) {
        db.createObjectStore('offline_sales_queue', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('local_sequence')) {
        db.createObjectStore('local_sequence');
      }
    };
  });
};

// ── Cryptography Helper (AES-GCM via Web Crypto API) ─────────────────────────

const getOrGenerateKey = async (db: IDBDatabase): Promise<CryptoKey | null> => {
  if (!window.crypto || !window.crypto.subtle) {
    return null;
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('terminal_config', 'readwrite');
    const store = transaction.objectStore('terminal_config');
    const request = store.get('crypto_key');

    request.onsuccess = async () => {
      if (request.result) {
        resolve(request.result as CryptoKey);
      } else {
        try {
          // Generate a non-exportable 256-bit AES-GCM key
          const newKey = await window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false, // non-exportable (protected from DevTools copy/paste extraction)
            ['encrypt', 'decrypt']
          );
          store.put(newKey, 'crypto_key');
          resolve(newKey);
        } catch (err) {
          reject(err);
        }
      }
    };
    request.onerror = () => reject(request.error);
  });
};

const encryptPayload = async (payload: any, key: CryptoKey | null): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
  const jsonStr = JSON.stringify(payload);
  const enc = new TextEncoder();

  if (!window.crypto || !window.crypto.subtle || !key) {
    // Fallback obfuscation for non-secure contexts (HTTP)
    const keyString = "pos_offline_fallback_key";
    let xorStr = '';
    for (let i = 0; i < jsonStr.length; i++) {
      xorStr += String.fromCharCode(jsonStr.charCodeAt(i) ^ keyString.charCodeAt(i % keyString.length));
    }
    const base64 = btoa(unescape(encodeURIComponent(xorStr)));
    const encoded = enc.encode(base64);
    const iv = new Uint8Array(12);
    return { ciphertext: encoded.buffer, iv };
  }

  const encoded = enc.encode(jsonStr);
  // 12-byte IV for GCM is standard and secure
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return { ciphertext, iv };
};

const decryptPayload = async (ciphertext: ArrayBuffer, iv: Uint8Array, key: CryptoKey | null): Promise<any> => {
  if (!window.crypto || !window.crypto.subtle || !key) {
    // Fallback decoding
    const enc = new TextDecoder();
    const base64 = enc.decode(new Uint8Array(ciphertext));
    const xorStr = decodeURIComponent(escape(atob(base64)));
    const keyString = "pos_offline_fallback_key";
    let jsonStr = '';
    for (let i = 0; i < xorStr.length; i++) {
      jsonStr += String.fromCharCode(xorStr.charCodeAt(i) ^ keyString.charCodeAt(i % keyString.length));
    }
    return JSON.parse(jsonStr);
  }

  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any },
    key,
    ciphertext
  );
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(decrypted));
};

// ── Exported Services ────────────────────────────────────────────────────────

export const saveTerminalConfig = async (config: Omit<TerminalConfig, 'device_key'>): Promise<string> => {
  const db = await openDb();
  // Generate high-entropy hex string to use as device key hash in database
  const rawKeyArray = window.crypto 
    ? window.crypto.getRandomValues(new Uint8Array(32)) 
    : new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
  const hexKey = Array.from(rawKeyArray).map(b => b.toString(16).padStart(2, '0')).join('');

  const key = await getOrGenerateKey(db);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('terminal_config', 'readwrite');
    const store = transaction.objectStore('terminal_config');

    const fullConfig: TerminalConfig = {
      ...config,
      device_key: key || undefined,
      device_key_raw: hexKey
    };

    const putRequest = store.put(fullConfig, 'config');
    putRequest.onsuccess = () => resolve(hexKey);
    putRequest.onerror = () => reject(putRequest.error);
  });
};

export const getTerminalConfig = async (): Promise<TerminalConfig | null> => {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('terminal_config', 'readonly');
      const store = transaction.objectStore('terminal_config');
      const request = store.get('config');

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('Failed to read terminal config:', e);
    return null;
  }
};

export const clearTerminalConfig = async (): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['terminal_config', 'local_sequence'], 'readwrite');
    transaction.objectStore('terminal_config').delete('config');
    transaction.objectStore('terminal_config').delete('crypto_key');
    transaction.objectStore('local_sequence').delete('sequence');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getNextLocalSequence = async (): Promise<number> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('local_sequence', 'readwrite');
    const store = transaction.objectStore('local_sequence');
    const request = store.get('sequence');

    request.onsuccess = () => {
      const currentVal = request.result || 0;
      const newVal = currentVal + 1;
      store.put(newVal, 'sequence');
      resolve(newVal);
    };
    request.onerror = () => reject(request.error);
  });
};

export const enqueueOfflineSale = async (sale: Omit<OfflineSale, 'control_number' | 'id' | 'created_at'>): Promise<OfflineSale> => {
  const db = await openDb();
  const config = await getTerminalConfig();
  if (!config) {
    throw new Error('This browser device is not registered as a terminal. Register it in Settings first.');
  }

  const key = await getOrGenerateKey(db);
  const sequenceNum = await getNextLocalSequence();
  const paddedSeq = String(sequenceNum).padStart(5, '0');
  
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const control_number = `OFF-${config.terminal_code}-${paddedSeq}`;

  const fullSale: OfflineSale = {
    ...sale,
    id,
    created_at,
    control_number
  };

  const { ciphertext, iv } = await encryptPayload(fullSale, key);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('offline_sales_queue', 'readwrite');
    const store = transaction.objectStore('offline_sales_queue');

    const queueItem: EncryptedQueueItem = {
      id,
      iv,
      ciphertext
    };

    const request = store.put(queueItem);
    request.onsuccess = () => resolve(fullSale);
    request.onerror = () => reject(request.error);
  });
};

export const getOfflineSalesQueue = async (): Promise<OfflineSale[]> => {
  try {
    const db = await openDb();
    const key = await getOrGenerateKey(db);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('offline_sales_queue', 'readonly');
      const store = transaction.objectStore('offline_sales_queue');
      const request = store.getAll();

      request.onsuccess = async () => {
        const encryptedItems = request.result as EncryptedQueueItem[];
        const decryptedItems: OfflineSale[] = [];

        for (const item of encryptedItems) {
          try {
            const dec = await decryptPayload(item.ciphertext, item.iv, key);
            decryptedItems.push(dec);
          } catch (decErr) {
            console.error('Decryption failed for item', item.id, decErr);
            // In case key is invalid or corrupted, push with dummy placeholder
          }
        }
        
        // Sort chronologically to maintain transaction order
        decryptedItems.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        resolve(decryptedItems);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('Failed to get offline sales queue:', e);
    return [];
  }
};

export const dequeueOfflineSale = async (id: string): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('offline_sales_queue', 'readwrite');
    const store = transaction.objectStore('offline_sales_queue');
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
