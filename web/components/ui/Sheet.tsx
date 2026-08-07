'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '@/lib/hooks/useScrollLock';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';

/**
 * Layer ladder. Rendering through a portal means paint order stops being DOM
 * order, so these values are the whole ordering contract.
 *
 * The device layer sitting above the request layer is the fix for the bug
 * where a PIN/passphrase prompt rendered underneath the WalletConnect modal
 * backdrop and could not be tapped, hard-blocking signing on a
 * passphrase-protected wallet.
 */
export const SHEET_LAYER = {
  request: 60,
  device: 70
} as const;

export type SheetLayer = keyof typeof SHEET_LAYER;

interface SheetProps {
  open: boolean;
  title: string;
  /** Rendered under the title; keep it to one line. */
  subtitle?: ReactNode;
  layer?: SheetLayer;
  /**
   * False for any sheet something is blocked on — a device operation mid-flight
   * or a dApp waiting on a request id. Those must be answered explicitly, so
   * backdrop tap, drag, Escape and the close button are all withheld.
   */
  dismissible?: boolean;
  onClose?: () => void;
  /** Sticky action row pinned below the scrolling body. */
  footer?: ReactNode;
  children: ReactNode;
}

export function Sheet({
  open,
  title,
  subtitle,
  layer = 'request',
  dismissible = true,
  onClose,
  footer,
  children
}: SheetProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Drag-to-dismiss offset, only ever driven from the grab handle.
  const [dragY, setDragY] = useState(0);
  const dragState = useRef<{ startY: number; startTime: number } | null>(null);

  useEffect(() => setMounted(true), []);
  useScrollLock(open);
  useFocusTrap(panelRef, open);

  const requestClose = useCallback(() => {
    if (!dismissible) return;
    onClose?.();
  }, [dismissible, onClose]);

  // Escape closes only dismissible sheets.
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, requestClose]);

  // Android hardware back closes the top sheet instead of leaving the page.
  useEffect(() => {
    if (!open || !dismissible || typeof window === 'undefined') return;
    const marker = { sifarSheet: titleId };
    window.history.pushState(marker, '');
    const onPop = () => requestClose();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Only unwind our own entry, never the user's real history.
      if ((window.history.state as any)?.sifarSheet === titleId) {
        window.history.back();
      }
    };
  }, [open, dismissible, titleId, requestClose]);

  // Keep the action row above the software keyboard. visualViewport is the
  // only reliable signal for this on Android Chrome.
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const inset = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop
      );
      panelRef.current?.style.setProperty('--kb-inset', `${inset}px`);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setDragY(0);
  }, [open]);

  const onHandleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dismissible) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    dragState.current = { startY: event.clientY, startTime: event.timeStamp };
  };

  const onHandleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    // Downward only; an upward drag should not detach the sheet from the edge.
    setDragY(Math.max(0, event.clientY - dragState.current.startY));
  };

  const onHandleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    dragState.current = null;
    if (!state) return;
    const distance = event.clientY - state.startY;
    const elapsed = Math.max(1, event.timeStamp - state.startTime);
    const velocity = distance / elapsed;
    if (distance > 96 || velocity > 0.5) {
      requestClose();
    }
    setDragY(0);
  };

  if (!mounted || !open) return null;

  const z = SHEET_LAYER[layer];

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: z }}>
      <div
        className="absolute inset-0 bg-ink/60"
        onClick={requestClose}
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 flex justify-center">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          style={{
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: dragState.current ? 'none' : 'transform 200ms ease-out'
          }}
          className="sheet-panel flex w-full max-w-md flex-col rounded-t-3xl border border-amber-200/60 bg-white shadow-2xl focus:outline-none"
        >
          {dismissible && (
            <div
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
              className="flex cursor-grab touch-none justify-center py-3 active:cursor-grabbing"
              aria-hidden="true"
            >
              <div className="h-1.5 w-10 rounded-full bg-amber-200" />
            </div>
          )}

          <div
            className={`flex items-start justify-between gap-3 px-5 ${
              dismissible ? 'pb-3' : 'pt-5 pb-3'
            }`}
          >
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className="font-display text-lg font-semibold text-ink"
              >
                {title}
              </h2>
              {subtitle && (
                <div className="mt-0.5 text-sm text-steel">{subtitle}</div>
              )}
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close"
                className="-mr-2 -mt-1 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-2xl leading-none text-steel hover:bg-amber-50"
              >
                ×
              </button>
            )}
          </div>

          <div className="scroll-contain flex-1 overflow-y-auto px-5 pb-4">
            {children}
          </div>

          {footer && (
            <div
              className="border-t border-amber-100 bg-white px-5 pt-4"
              style={{
                paddingBottom:
                  'calc(var(--kb-inset, 0px) + max(1rem, env(safe-area-inset-bottom)))'
              }}
            >
              {footer}
            </div>
          )}

          {!footer && (
            <div
              style={{
                paddingBottom:
                  'calc(var(--kb-inset, 0px) + max(0.5rem, env(safe-area-inset-bottom)))'
              }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
