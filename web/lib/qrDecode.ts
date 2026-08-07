'use client';

import jsQR from 'jsqr';

/**
 * QR decoding shared by the camera scanner, the file/camera-capture input and
 * the desktop clipboard-paste path, so all three behave identically.
 *
 * Uses `jsqr`, which is already a dependency (and lint-required to stay), so
 * the camera path costs no new package.
 */

/** Longest edge fed to jsQR. Decode cost is linear in pixel count. */
const MAX_EDGE = 640;

export function decodeQrFromImageData(image: ImageData): string | null {
  const result = jsQR(image.data, image.width, image.height, {
    inversionAttempts: 'dontInvert'
  });
  return result?.data?.trim() || null;
}

/**
 * Draw a source into a scratch canvas, downscaled, and decode it.
 * Accepts anything canvas can draw: a video frame or a decoded image bitmap.
 */
export function decodeQrFromSource(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvas: HTMLCanvasElement
): string | null {
  if (!sourceWidth || !sourceHeight) return null;

  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(source, 0, 0, width, height);
  return decodeQrFromImageData(ctx.getImageData(0, 0, width, height));
}

/** Decode a QR from an image file — camera capture, gallery pick, or paste. */
export async function decodeQrFromBlob(blob: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    return decodeQrFromSource(bitmap, bitmap.width, bitmap.height, canvas);
  } finally {
    bitmap.close?.();
  }
}

/** Pull the first image out of a paste event, if there is one. */
export function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  const item = Array.from(data.items).find(
    (entry) => entry.kind === 'file' && entry.type.startsWith('image/')
  );
  return item?.getAsFile() ?? null;
}
