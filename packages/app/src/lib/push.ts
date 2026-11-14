import type { PushSubscription as WirePushSubscription } from '@deepseekharness-mobile/protocol';

export type PushSupport = 'ready' | 'unsupported' | 'insecure' | 'denied';

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushSupport(): PushSupport {
  if (!supported()) return 'unsupported';
  if (!globalThis.isSecureContext) return 'insecure';
  if (Notification.permission === 'denied') return 'denied';
  return 'ready';
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function wireOf(subscription: globalThis.PushSubscription): WirePushSubscription {
  const json = subscription.toJSON();
  const p256dh = json.keys?.['p256dh'];
  const auth = json.keys?.['auth'];
  if (!p256dh || !auth) throw new Error('The push subscription has no keys.');

  return {
    endpoint: subscription.endpoint,
    keys: { p256dh, auth },
    ...(subscription.expirationTime ? { expirationTime: subscription.expirationTime } : {}),
  };
}

export async function currentPushSubscription(): Promise<WirePushSubscription | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? wireOf(subscription) : undefined;
}

export async function subscribePush(publicKey: string): Promise<WirePushSubscription> {
  if (!supported()) throw new Error('This browser does not support push notifications.');

  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return wireOf(existing);

  const created = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  return wireOf(created);
}

export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  return globalThis.matchMedia?.('(display-mode: standalone)').matches ?? false;
}
