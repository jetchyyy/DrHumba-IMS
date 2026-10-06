/**
 * notificationService.ts
 * Browser Push Notification + Sound Utility
 * Handles Web Notifications API permission & delivery, and audio chime.
 */

const NOTIFICATION_MUTED_KEY = 'drhumba_notification_muted';
const NOTIFICATION_PERMISSION_ASKED_KEY = 'drhumba_notification_permission_asked';

// ── Permission ─────────────────────────────────────────────────────────────────

/**
 * Check whether browser push notifications are supported & granted.
 */
export const isNotificationSupported = (): boolean => {
  return 'Notification' in window;
};

export const getNotificationPermission = (): NotificationPermission | 'unsupported' => {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
};

/**
 * Request notification permission from the user.
 * Must be called from a user-gesture context (button click etc.).
 * Returns true if permission was granted.
 */
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!isNotificationSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const result = await Notification.requestPermission();
    localStorage.setItem(NOTIFICATION_PERMISSION_ASKED_KEY, 'true');
    return result === 'granted';
  } catch {
    return false;
  }
};

/**
 * Returns true if the permission prompt has not been shown yet.
 */
export const shouldPromptForPermission = (): boolean => {
  if (!isNotificationSupported()) return false;
  if (Notification.permission !== 'default') return false;
  return localStorage.getItem(NOTIFICATION_PERMISSION_ASKED_KEY) !== 'true';
};

// ── Browser Push Notifications ─────────────────────────────────────────────────

export interface PushNotificationOptions {
  body?: string;
  tag?: string;
  /** Navigate to this tab when the notification is clicked (passed via setActiveTab) */
  targetTab?: string;
  onClickNavigate?: () => void;
}

/**
 * Fire a browser (OS-level) push notification.
 * Silently no-ops if permission is not granted.
 */
export const sendBrowserNotification = (
  title: string,
  options?: PushNotificationOptions
): void => {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;

  const notif = new Notification(title, {
    icon: '/drhumbalogo-192.png',
    badge: '/drhumbalogo-192.png',
    body: options?.body,
    tag: options?.tag,
    requireInteraction: false,
  });

  notif.onclick = () => {
    window.focus();
    options?.onClickNavigate?.();
    notif.close();
  };

  // Auto-close after 6 seconds
  setTimeout(() => notif.close(), 6000);
};

// ── Notification Sound ─────────────────────────────────────────────────────────

/**
 * Play the notification chime sound.
 * Silently no-ops if the user has muted sounds or autoplay is blocked.
 */
export const playNotificationSound = (): void => {
  try {
    const muted = localStorage.getItem(NOTIFICATION_MUTED_KEY) === 'true';
    if (muted) return;

    // Use Web Audio API to generate a simple pleasant chime tone
    // This avoids needing to host an audio file
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();

    const playTone = (freq: number, startTime: number, duration: number, gain: number) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, startTime);

      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    // Two-note pleasant chime: C5 → E5
    const now = ctx.currentTime;
    playTone(523.25, now, 0.4, 0.25);        // C5
    playTone(659.25, now + 0.15, 0.5, 0.20); // E5

    // Close context after sounds finish to avoid memory leaks
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // Silently ignore autoplay or AudioContext restrictions
  }
};

/**
 * Check if notification sounds are muted.
 */
export const isNotificationMuted = (): boolean => {
  return localStorage.getItem(NOTIFICATION_MUTED_KEY) === 'true';
};

/**
 * Toggle notification sound mute state.
 */
export const setNotificationMuted = (muted: boolean): void => {
  localStorage.setItem(NOTIFICATION_MUTED_KEY, String(muted));
};
