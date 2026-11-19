const STORAGE_KEY = 'pos_kiosk_lock_v1';

interface StoredPosLock {
  locked: boolean;
  salt: string;
  pinHash: string;
}

export function isValidLockPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

function generateSalt(): string {
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

async function hashPinWithSalt(pin: string, salt: string): Promise<string> {
  const input = `${salt}:${pin}:pos_kiosk_lock`;
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : globalThis.crypto;

  if (cryptoObj?.subtle) {
    const encoded = new TextEncoder().encode(input);
    const digest = await cryptoObj.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Deterministic non-crypto fallback for plain HTTP contexts without crypto.subtle
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `fb:${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function readLockRecord(): StoredPosLock | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPosLock>;
    if (
      typeof parsed?.locked === 'boolean' &&
      typeof parsed?.salt === 'string' &&
      typeof parsed?.pinHash === 'string'
    ) {
      return parsed as StoredPosLock;
    }
    return null;
  } catch {
    return null;
  }
}

export function isPosLocked(): boolean {
  return Boolean(readLockRecord()?.locked);
}

export async function lockPosWithPin(pin: string): Promise<void> {
  if (!isValidLockPin(pin)) {
    throw new Error('PIN must be 4 to 6 numeric digits.');
  }
  const salt = generateSalt();
  const pinHash = await hashPinWithSalt(pin, salt);
  const record: StoredPosLock = {
    locked: true,
    salt,
    pinHash,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

export async function verifyAndUnlockPosPin(pin: string): Promise<boolean> {
  const record = readLockRecord();
  if (!record || !record.locked) {
    return true;
  }
  if (!isValidLockPin(pin)) {
    return false;
  }
  const candidateHash = await hashPinWithSalt(pin, record.salt);
  if (candidateHash !== record.pinHash) {
    return false;
  }
  localStorage.removeItem(STORAGE_KEY);
  return true;
}

export function forceUnlockPos(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
