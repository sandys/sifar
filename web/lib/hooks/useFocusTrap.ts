'use client';

import { useEffect, RefObject } from 'react';

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

/**
 * Keep Tab focus inside a sheet while it is open, and give focus back to
 * whatever opened it on close.
 *
 * Without this, Tab walks into the page behind the sheet — which for a
 * non-dismissible signing sheet means reaching controls that are supposed to
 * be blocked.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  active: boolean
): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the panel itself rather than its first control: auto-focusing a
    // button on a signing sheet puts an irreversible action one Enter away.
    node.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;

      if (event.shiftKey && (current === first || current === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [ref, active]);
}
