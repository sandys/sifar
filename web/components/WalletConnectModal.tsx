'use client';

import { useEffect, useMemo, useState, ClipboardEvent, ChangeEvent } from 'react';
import jsQR from 'jsqr';
import {
  approveSessionProposal,
  pairWithDApp,
  rejectSessionProposal
} from '@/lib/walletconnect';
import { useAppStore } from '@/lib/store';
import { setWalletConnectProjectId } from '@/lib/walletconnect';

interface WalletConnectModalProps {
  open: boolean;
  account?: { address: string; path: string } | null;
  onClose: () => void;
}

function isValidWcUri(input: string) {
  if (!input.startsWith('wc:')) return false;
  if (!input.includes('@2')) return false;
  if (!input.includes('symKey=')) return false;
  return true;
}

export function WalletConnectModal({
  open,
  account,
  onClose
}: WalletConnectModalProps) {
  const activeSession = useAppStore((state) => state.activeSession);
  const pendingProposal = useAppStore((state) => state.pendingProposal);
  const setPendingProposal = useAppStore((state) => state.setPendingProposal);
  const setActiveSession = useAppStore((state) => state.setActiveSession);
  const setStatusMessage = useAppStore((state) => state.setStatusMessage);
  const wcProjectId = useAppStore((state) => state.wcProjectId);
  const setWcProjectId = useAppStore((state) => state.setWcProjectId);
  const [wcUri, setWcUri] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projectIdInput, setProjectIdInput] = useState('');

  useEffect(() => {
    if (!open) return;
    setWcUri('');
    setStatus('');
    setError(null);
    setBusy(false);
    setProjectIdInput(wcProjectId || '');
  }, [open, account?.address]);

  useEffect(() => {
    if (activeSession && open && status.startsWith('Pairing')) {
      setStatus(`Connected to ${activeSession.peerName}.`);
    }
  }, [activeSession, open, status]);

  useEffect(() => {
    if (!open) return;
    if (activeSession) {
      const timer = setTimeout(() => onClose(), 800);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [activeSession, onClose, open]);

  const handleWcUri = async (rawUri: string) => {
    const cleaned = rawUri.trim();
    if (!account) {
      setError('Pick an account first.');
      return;
    }
    if (!wcProjectId) {
      setError('WalletConnect Project ID required.');
      return;
    }
    if (!isValidWcUri(cleaned)) {
      setError('Invalid WalletConnect URI.');
      return;
    }
    setError(null);
    setStatus('Pairing with dApp…');
    setBusy(true);
    try {
      await pairWithDApp(cleaned);
      setStatus('Paired. Waiting for session proposal…');
      setStatusMessage('WalletConnect pairing started.');
    } catch (err: any) {
      setError(err?.message || 'Pairing failed');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const handleTextPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text');
    if (!text) return;
    event.preventDefault();
    setWcUri(text.trim());
    handleWcUri(text);
  };

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setWcUri(event.target.value);
  };

  const handleImagePaste = async (event: ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.clipboardData.items);
    const imageItem = items.find(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    );
    if (!imageItem) {
      setError('Paste a QR code image from the clipboard.');
      return;
    }
    event.preventDefault();
    setError(null);
    setStatus('Decoding QR image…');
    setBusy(true);
    try {
      const file = imageItem.getAsFile();
      if (!file) {
        throw new Error('Unable to read image from clipboard.');
      }
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not read image data.');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(imageData.data, imageData.width, imageData.height);
      if (!result?.data) {
        throw new Error('No QR code detected in the image.');
      }
      setWcUri(result.data.trim());
      await handleWcUri(result.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to decode QR image.');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const modalTitle = useMemo(() => {
    if (!account) return 'WalletConnect';
    return `WalletConnect · ${account.address.slice(0, 4)}…${account.address.slice(
      -4
    )}`;
  }, [account]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-amber-200/40 bg-white p-5 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.8)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
              {modalTitle}
            </p>
            {account ? (
              <p className="mt-2 text-xs text-steel">
                Selected path {account.path.replace('m/', '')}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-amber-200 px-3 py-1 text-xs text-steel"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-4">
          {!wcProjectId && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
                WalletConnect Project ID
              </p>
              <input
                className="mt-2 w-full rounded-2xl border border-amber-200 bg-white px-3 py-2 text-xs text-ink"
                placeholder="Paste project ID from cloud.walletconnect.com"
                value={projectIdInput}
                onChange={(event) => setProjectIdInput(event.target.value)}
              />
              <button
                type="button"
                className="mt-2 rounded-lg border border-amber-200 px-3 py-1 text-xs uppercase tracking-wide text-steel"
                onClick={() => {
                  const trimmed = projectIdInput.trim();
                  if (!trimmed) {
                    setError('Project ID is required.');
                    return;
                  }
                  setWcProjectId(trimmed);
                  setWalletConnectProjectId(trimmed);
                  setError(null);
                  setStatus('Project ID saved. Paste a wc: URI to connect.');
                }}
              >
                Save Project ID
              </button>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
              Paste QR Image
            </p>
            <div
              className="mt-2 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-xs text-steel"
              onPaste={handleImagePaste}
              tabIndex={0}
              role="textbox"
              aria-label="Paste QR image"
            >
              Paste a QR code image here (Ctrl/Cmd + V).
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
              Paste WalletConnect URI
            </p>
            <textarea
              className="mt-2 h-24 w-full rounded-2xl border border-amber-200 bg-white px-3 py-2 text-xs text-ink"
              placeholder="Paste wc:... URI here"
              value={wcUri}
              onChange={handleTextChange}
              onPaste={handleTextPaste}
            />
          </div>
        </div>

        <div className="mt-4 text-xs text-steel">
          {status && <p>{status}</p>}
          {busy && <p className="mt-1">Working…</p>}
          {error && <p className="mt-2 text-ember">{error}</p>}
        </div>

        {pendingProposal && account && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-xs text-ink">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-700">
              Session Proposal
            </p>
            <p className="mt-2 text-sm font-semibold">
              {pendingProposal.proposer.name}
            </p>
            <p className="text-xs text-steel">{pendingProposal.proposer.url}</p>
            <p className="mt-2 text-xs text-steel">
              Approve connection for{' '}
              <span className="font-mono">{account.address}</span>.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-lg border border-amber-200 px-3 py-1 text-xs uppercase tracking-wide text-steel"
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const session = await approveSessionProposal(
                      pendingProposal.id,
                      account.address
                    );
                    setActiveSession({
                      topic: session.topic,
                      peerName: session.peer.metadata.name,
                      peerUrl: session.peer.metadata.url,
                      peerIcon: session.peer.metadata.icons?.[0],
                      chains: Object.keys(session.namespaces || {})
                    });
                    setPendingProposal(null);
                    setStatus(`Connected to ${session.peer.metadata.name}.`);
                  } catch (err: any) {
                    setError(err?.message || 'Failed to approve session.');
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                Approve
              </button>
              <button
                type="button"
                className="rounded-lg border border-amber-200 px-3 py-1 text-xs uppercase tracking-wide text-steel"
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await rejectSessionProposal(pendingProposal.id);
                    setPendingProposal(null);
                    setStatus('Session rejected.');
                  } catch (err: any) {
                    setError(err?.message || 'Failed to reject session.');
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                Reject
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-amber-200 px-3 py-1 text-xs uppercase tracking-wide text-steel"
            onClick={() => {
              if (!wcUri) return;
              handleWcUri(wcUri);
            }}
            disabled={!wcUri || busy || !wcProjectId}
          >
            Connect WalletConnect
          </button>
        </div>
      </div>
    </div>
  );
}
