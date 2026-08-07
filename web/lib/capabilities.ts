/**
 * Browser capability detection.
 *
 * The gate for signing is feature detection, never the user agent: UA is only
 * used to write a more specific instruction once we already know something is
 * missing.
 */

export type Platform = 'ios' | 'android' | 'desktop' | 'unknown';
export type BrowserHint = 'chrome' | 'safari' | 'firefox' | 'inapp' | 'other';

export interface Capabilities {
  /** False until the post-mount effect has run. Render neutrally until then. */
  hydrated: boolean;
  secureContext: boolean;
  webusb: boolean;
  camera: boolean;
  platform: Platform;
  browserHint: BrowserHint;
  /** The only thing that decides whether the wizard can proceed. */
  canSign: boolean;
}

export const UNKNOWN_CAPABILITIES: Capabilities = {
  hydrated: false,
  secureContext: false,
  webusb: false,
  camera: false,
  platform: 'unknown',
  browserHint: 'other',
  canSign: false
};

export function detectPlatform(ua: string, maxTouchPoints: number, platform: string): Platform {
  // iPadOS reports itself as MacIntel; touch points are what distinguish it.
  if (/iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/i.test(ua)) return 'android';
  if (/Mac|Win|Linux|CrOS/i.test(platform || ua)) return 'desktop';
  return 'unknown';
}

export function detectBrowser(ua: string): BrowserHint {
  // In-app webviews are checked first: they often carry a Chrome token too, but
  // do not expose WebUSB.
  if (/FBAN|FBAV|Instagram|Line\/|Twitter|TelegramBot|; wv\)/i.test(ua)) {
    return 'inapp';
  }
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/Edg\//i.test(ua)) return 'chrome';
  if (/Chrome|CriOS/i.test(ua)) return /CriOS/i.test(ua) ? 'safari' : 'chrome';
  if (/Safari/i.test(ua)) return 'safari';
  return 'other';
}

export function readCapabilities(): Capabilities {
  const nav = navigator as any;
  const ua = nav.userAgent || '';
  const secureContext = window.isSecureContext;
  const webusb = 'usb' in nav;

  return {
    hydrated: true,
    secureContext,
    webusb,
    camera: !!nav.mediaDevices?.getUserMedia,
    platform: detectPlatform(ua, nav.maxTouchPoints || 0, nav.platform || ''),
    browserHint: detectBrowser(ua),
    canSign: webusb && secureContext
  };
}
