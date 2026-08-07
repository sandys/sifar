'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { decodeQrFromBlob, decodeQrFromSource } from '@/lib/qrDecode';

type ScanState =
  | { kind: 'starting' }
  | { kind: 'scanning' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'denied'; message: string }
  | { kind: 'failed'; message: string };

/** ~10fps. Faster gains nothing and burns battery behind a decode this cheap. */
const FRAME_INTERVAL_MS = 100;

interface QrScannerProps {
  /**
   * Return true to accept the code and stop scanning; return false to keep
   * scanning. Lets the caller reject a non-WalletConnect QR without the
   * scanner closing on a stray poster code.
   */
  onDecode: (value: string) => boolean;
  hint?: string;
}

export function QrScanner({ onDecode, hint }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;

  const [state, setState] = useState<ScanState>({ kind: 'starting' });
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [rejectedHint, setRejectedHint] = useState(false);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    stoppedRef.current = false;
    setState({ kind: 'starting' });

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState({
        kind: 'unavailable',
        message: 'This browser cannot open a camera. Use one of the options below.'
      });
      return;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setState({
        kind: 'unavailable',
        message: 'Camera access needs HTTPS. Use one of the options below.'
      });
      return;
    }

    const attempt = async (constraints: MediaStreamConstraints) =>
      navigator.mediaDevices.getUserMedia(constraints);

    let stream: MediaStream;
    try {
      stream = await attempt({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setState({
          kind: 'denied',
          message:
            'Camera permission was denied. Allow it from the lock icon in the address bar, then try again.'
        });
        return;
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        // Retry once without the rear-camera preference.
        try {
          stream = await attempt({ video: true, audio: false });
        } catch {
          setState({
            kind: 'failed',
            message: 'No camera was found on this device.'
          });
          return;
        }
      } else if (name === 'NotReadableError') {
        setState({
          kind: 'failed',
          message: 'The camera is in use by another app.'
        });
        return;
      } else {
        setState({
          kind: 'failed',
          message: err?.message || 'Could not start the camera.'
        });
        return;
      }
    }

    if (stoppedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) return;

    // srcObject, never URL.createObjectURL: media-src is unset in the CSP and
    // falls back to default-src 'self', which would block a blob: URL.
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Safari throws AbortError if the element unmounts mid-play; harmless.
    }

    const track = stream.getVideoTracks()[0];
    const caps = track?.getCapabilities?.() as any;
    setTorchAvailable(!!caps && 'torch' in caps);

    setState({ kind: 'scanning' });

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    let lastFrame = 0;

    const tick = (timestamp: number) => {
      if (stoppedRef.current) return;
      rafRef.current = requestAnimationFrame(tick);
      if (timestamp - lastFrame < FRAME_INTERVAL_MS) return;
      lastFrame = timestamp;

      const el = videoRef.current;
      const canvas = canvasRef.current;
      // iOS reports 0x0 for several frames after play() resolves.
      if (!el || !canvas || el.readyState < 2 || !el.videoWidth) return;

      let value: string | null = null;
      try {
        value = decodeQrFromSource(el, el.videoWidth, el.videoHeight, canvas);
      } catch {
        return;
      }
      if (!value) return;

      // Validate before tearing down, so an unrelated QR does not close the
      // scanner and drop the user back with nothing.
      if (onDecodeRef.current(value)) {
        stop();
      } else {
        setRejectedHint(true);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [stop]);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  // Release the camera when the tab is backgrounded, or Android Chrome leaves
  // the camera indicator lit while the app is not visible.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', stop);
    };
  }, [stop]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as any] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  };

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    try {
      const value = await decodeQrFromBlob(file);
      if (!value) {
        setRejectedHint(true);
        return;
      }
      if (onDecodeRef.current(value)) stop();
      else setRejectedHint(true);
    } catch {
      setRejectedHint(true);
    }
  };

  // The video element must stay mounted while starting so the ref exists when
  // the stream arrives; `scanning` is what decides whether it has a picture.
  const mounted = state.kind === 'scanning' || state.kind === 'starting';
  const live = state.kind === 'scanning';

  return (
    <div className="grid gap-3">
      <div className="relative overflow-hidden rounded-2xl border border-amber-200 bg-ink">
        <video
          ref={videoRef}
          // playsInline is required on iOS or the video takes over fullscreen.
          playsInline
          muted
          autoPlay
          className={`aspect-square w-full object-cover ${mounted ? '' : 'hidden'}`}
        />
        {state.kind === 'starting' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
            Starting camera…
          </p>
        )}
        {live && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden="true"
          >
            <div className="h-48 w-48 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
        {!mounted && (
          <p className="px-4 py-10 text-center text-sm text-white/80">
            {state.message}
          </p>
        )}
      </div>

      <p className="text-sm text-steel" aria-live="polite">
        {rejectedHint
          ? 'That code is not a WalletConnect link. Keep the dApp’s QR in frame.'
          : hint || 'Point the camera at the dApp’s WalletConnect QR code.'}
      </p>

      {torchAvailable && live && (
        <Button variant="ghost" onClick={toggleTorch}>
          {torchOn ? 'Torch off' : 'Torch on'}
        </Button>
      )}

      {(state.kind === 'denied' || state.kind === 'failed') && (
        <Button variant="ghost" onClick={start}>
          Try camera again
        </Button>
      )}

      <label className="flex min-h-[48px] cursor-pointer items-center justify-center rounded-2xl border border-amber-200 bg-white/60 px-4 text-base font-semibold text-steel">
        Upload or photograph a QR
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => onPickFile(event.target.files?.[0] ?? null)}
        />
      </label>
    </div>
  );
}
