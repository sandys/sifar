'use client';

import { useEffect } from 'react';

/**
 * Refcounted body scroll lock.
 *
 * Refcounting is load-bearing, not defensive: a device prompt can open on top
 * of the signing sheet. With a naive lock, closing the device sheet restores
 * `overflow` while the signing sheet is still open and the page scrolls behind
 * it.
 */
let lockCount = 0;
let restore: (() => void) | null = null;

function acquire() {
  lockCount += 1;
  if (lockCount > 1 || typeof document === 'undefined') return;

  const body = document.body;
  const previousOverflow = body.style.overflow;
  const previousPaddingRight = body.style.paddingRight;

  // Compensate for a disappearing desktop scrollbar so the layout does not
  // shift sideways when a sheet opens. On phones this is 0.
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;

  body.style.overflow = 'hidden';
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

  restore = () => {
    body.style.overflow = previousOverflow;
    body.style.paddingRight = previousPaddingRight;
  };
}

function release() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0 && restore) {
    restore();
    restore = null;
  }
}

export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    acquire();
    return release;
  }, [active]);
}
