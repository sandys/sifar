'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { pairWithDApp } from '@/lib/walletconnect';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/Button';

interface ScannerProps {
  onScanSuccess?: (uri: string) => void;
  onScanError?: (error: string) => void;
}

export function Scanner({ onScanSuccess, onScanError }: ScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setStatusMessage = useAppStore((state) => state.setStatusMessage);

  const startScanning = useCallback(async () => {
    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 240, height: 240 }
        },
        async (decodedText) => {
          if (!decodedText.startsWith('wc:')) return;
          await scanner.stop();
          setIsScanning(false);

          if (onScanSuccess) {
            onScanSuccess(decodedText);
            return;
          }

          try {
            setStatusMessage('Pairing with dApp...');
            await pairWithDApp(decodedText);
            setStatusMessage('Pairing request sent. Awaiting approval.');
          } catch (err: any) {
            setStatusMessage(null);
            setError(err.message || 'Pairing failed');
          }
        },
        () => {
          // Ignore per-frame scan errors
        }
      );

      setIsScanning(true);
    } catch (err: any) {
      const message = err.message || 'Failed to start camera';
      setError(message);
      onScanError?.(message);
    }
  }, [onScanSuccess, onScanError, setStatusMessage]);

  useEffect(() => {
    return () => {
      scannerRef.current?.stop().catch(() => {});
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        id="qr-reader"
        className="w-full max-w-[300px] overflow-hidden rounded-2xl border border-amber-200/40 bg-white"
      />

      {!isScanning && !error && (
        <Button onClick={startScanning} variant="ghost">
          Start Camera
        </Button>
      )}

      {error && (
        <div className="text-center text-sm text-ember">
          <p>{error}</p>
          <button
            onClick={() => {
              setError(null);
              startScanning();
            }}
            className="mt-2 text-xs font-semibold underline"
          >
            Try Again
          </button>
        </div>
      )}

      {isScanning && (
        <p className="text-xs text-steel">
          Point your camera at the WalletConnect QR code.
        </p>
      )}
    </div>
  );
}
