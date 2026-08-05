'use client';

import { useEffect, useMemo, useState, useRef, ClipboardEvent, ChangeEvent } from 'react';
import jsQR from 'jsqr';
import {
  approveSessionProposal,
  pairWithDApp,
  rejectSessionProposal,
  disconnectSession,
  pingSession,
  restartRelay,
  getRelayConnectionState
} from '@/lib/walletconnect';
import {
  approveCurrentRequest,
  approveBatchRequest,
  approveAndSendRequest,
  approveMessageRequest,
  rejectCurrentRequest
} from '@/lib/signing';
import { useAppStore } from '@/lib/store';
import { setWalletConnectProjectId } from '@/lib/walletconnect';
import { useUrlState } from '@/lib/hooks/useUrlState';
import {
  getSafeWalletConnectUriLog,
  parseWalletConnectUri
} from '@/lib/walletConnectUri';

interface WalletConnectModalProps {
  open: boolean;
  account?: { address: string; path: string } | null;
  onClose: () => void;
}

export function WalletConnectModal({
  open,
  account,
  onClose
}: WalletConnectModalProps) {
  const activeSessions = useAppStore((state) => state.activeSessions);
  const pendingProposal = useAppStore((state) => state.pendingProposal);
  const pendingRequest = useAppStore((state) => state.pendingRequest);
  const setPendingProposal = useAppStore((state) => state.setPendingProposal);
  const addActiveSession = useAppStore((state) => state.addActiveSession);
  const removeActiveSession = useAppStore((state) => state.removeActiveSession);
  const setStatusMessage = useAppStore((state) => state.setStatusMessage);
  const wcProjectId = useAppStore((state) => state.wcProjectId);
  const setWcProjectId = useAppStore((state) => state.setWcProjectId);
  const wcEventLog = useAppStore((state) => state.wcEventLog);
  const clearWcEventLog = useAppStore((state) => state.clearWcEventLog);
  const addWcEvent = useAppStore((state) => state.addWcEvent);

  // Sessions for the current wallet address
  const sessionsForWallet = useMemo(
    () => activeSessions.filter((s) => s.walletAddress === account?.address),
    [activeSessions, account?.address]
  );
  const [wcUri, setWcUri] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projectIdInput, setProjectIdInput] = useState('');
  const [sessionStatus, setSessionStatus] = useState<Record<string, 'idle' | 'pinging' | 'ok' | 'error'>>({});
  const [relayStatus, setRelayStatus] = useState<'unknown' | 'connected' | 'disconnected' | 'reconnecting'>('unknown');
  const [signing, setSigning] = useState(false);
  const [eventLogOpen, setEventLogOpen] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(() => new Set());
  const [addressCopied, setAddressCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const eventLogRef = useRef<HTMLDivElement>(null);
  const { copyShareableUrl } = useUrlState();

  const toggleEventExpanded = (eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const formatEventTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getEventTypeColor = (type: string) => {
    switch (type) {
      case 'pairing_started':
        return 'text-cyan-400';
      case 'pairing_success':
        return 'text-cyan-300';
      case 'session_proposal':
        return 'text-yellow-400';
      case 'session_approved':
        return 'text-green-400';
      case 'session_rejected':
        return 'text-red-400';
      case 'session_request':
        return 'text-blue-400';
      case 'request_approved':
        return 'text-green-400';
      case 'request_rejected':
        return 'text-red-400';
      case 'session_deleted':
        return 'text-gray-400';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-gray-300';
    }
  };

  // Check if there's a signing request for this wallet's sessions
  const signingRequestForWallet = useMemo(() => {
    if (!pendingRequest) return null;
    const session = sessionsForWallet.find((s) => s.topic === pendingRequest.topic);
    return session ? pendingRequest : null;
  }, [pendingRequest, sessionsForWallet]);

  // Get signing request summary
  const signingRequestSummary = useMemo(() => {
    if (!signingRequestForWallet) return null;
    const req = signingRequestForWallet;
    switch (req.type) {
      case 'solana_signMessage':
        return { title: 'Sign Message', description: req.humanMessage || 'Binary message' };
      case 'solana_signAllTransactions':
        return { title: 'Sign Multiple Transactions', description: `${req.transactions?.length || 0} transactions` };
      case 'solana_signAndSendTransaction':
        return { title: 'Sign & Send Transaction', description: 'Transaction will be broadcast to Solana mainnet.' };
      default:
        return { title: 'Sign Transaction', description: 'Single Solana transaction request.' };
    }
  }, [signingRequestForWallet]);

  // Reset transient state when modal opens
  useEffect(() => {
    if (!open) return;
    setWcUri('');
    setError(null);
    setBusy(false);
    setProjectIdInput(wcProjectId || '');
    setStatus('');
    setSessionStatus({});
    // Check relay status
    setRelayStatus(getRelayConnectionState() as any);
  }, [open, wcProjectId]);

  // Ping a session to check if it's still alive
  const handlePingSession = async (topic: string) => {
    setSessionStatus((prev) => ({ ...prev, [topic]: 'pinging' }));
    const ok = await pingSession(topic);
    setSessionStatus((prev) => ({ ...prev, [topic]: ok ? 'ok' : 'error' }));
  };

  // Restart relay connection
  const handleRestartRelay = async () => {
    setRelayStatus('reconnecting');
    setError(null);
    try {
      await restartRelay();
      setRelayStatus('connected');
      setStatus('Relay reconnected.');
      // Re-ping all sessions
      for (const session of sessionsForWallet) {
        handlePingSession(session.topic);
      }
    } catch (err: any) {
      setRelayStatus('disconnected');
      setError(err?.message || 'Failed to reconnect relay.');
    }
  };

  // Handle signing approval
  const handleApproveSigning = async () => {
    if (!signingRequestForWallet) return;
    const req = signingRequestForWallet;
    const session = sessionsForWallet.find((s) => s.topic === req.topic);
    setSigning(true);
    setError(null);
    try {
      switch (req.type) {
        case 'solana_signMessage':
          await approveMessageRequest();
          break;
        case 'solana_signAllTransactions':
          await approveBatchRequest();
          break;
        case 'solana_signAndSendTransaction':
          await approveAndSendRequest();
          break;
        default:
          await approveCurrentRequest();
      }
      addWcEvent({
        type: 'request_approved',
        peerName: session?.peerName || 'Unknown',
        method: req.type,
        topic: req.topic,
        details: `Approved ${req.type} from ${session?.peerName || 'Unknown'}`,
        rawParams: JSON.stringify({ requestId: req.requestId, type: req.type, topic: req.topic }, null, 2)
      });
      setStatus('Signed successfully.');
    } catch (err: any) {
      console.error('[Modal] Signing failed:', err);
      addWcEvent({
        type: 'error',
        peerName: session?.peerName || 'Unknown',
        method: req.type,
        topic: req.topic,
        details: `Signing failed: ${err?.message || 'Unknown error'}`,
        rawParams: JSON.stringify({ requestId: req.requestId, type: req.type, error: err?.message }, null, 2)
      });
      setError(err?.message || 'Signing failed.');
    } finally {
      setSigning(false);
    }
  };

  // Handle signing rejection - works even during signing to allow cancel
  const handleRejectSigning = async () => {
    const req = signingRequestForWallet || pendingRequest;
    if (!req) return;
    const session = sessionsForWallet.find((s) => s.topic === req.topic);

    // If we're in the middle of signing, this is a force cancel
    const wasSigningInProgress = signing;

    setError(null);
    try {
      await rejectCurrentRequest();
      addWcEvent({
        type: 'request_rejected',
        peerName: session?.peerName || 'Unknown',
        method: req.type,
        topic: req.topic,
        details: wasSigningInProgress
          ? `Cancelled ${req.type} (was signing)`
          : `Rejected ${req.type} from ${session?.peerName || 'Unknown'}`,
        rawParams: JSON.stringify({ requestId: req.requestId, type: req.type, topic: req.topic, cancelled: wasSigningInProgress }, null, 2)
      });
      setStatus(wasSigningInProgress ? 'Signing cancelled.' : 'Request rejected.');
    } catch (err: any) {
      // Even if reject fails, clear local state to unblock UI
      setError(err?.message || 'Failed to reject.');
    } finally {
      setSigning(false);
    }
  };


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
    let uriInfo;
    try {
      uriInfo = parseWalletConnectUri(cleaned);
    } catch (validationError: any) {
      setError(validationError?.message || 'Invalid WalletConnect URI.');
      return;
    }
    const safeUriLog = getSafeWalletConnectUriLog(uriInfo);
    setError(null);
    setStatus('Pairing with dApp…');
    setBusy(true);
    console.log('[Modal] Valid WalletConnect pairing URI', {
      ...safeUriLog,
      walletAddress: account.address,
      derivationPath: account.path
    });
    addWcEvent({
      type: 'pairing_started',
      details: `Initiating WalletConnect pairing`,
      rawParams: JSON.stringify(safeUriLog, null, 2)
    });
    try {
      await pairWithDApp(cleaned);
      setStatus('Paired. Waiting for session proposal…');
      setStatusMessage('WalletConnect pairing started.');
      addWcEvent({
        type: 'pairing_success',
        details: 'Pairing successful, waiting for session proposal',
        rawParams: JSON.stringify({ timestamp: Date.now() }, null, 2)
      });
    } catch (err: any) {
      setError(err?.message || 'Pairing failed');
      setStatus('');
      addWcEvent({
        type: 'error',
        details: `Pairing failed: ${err?.message || 'Unknown error'}`,
        rawParams: JSON.stringify({ error: err?.message }, null, 2)
      });
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

  const handleCopyAddress = () => {
    if (!account) return;
    navigator.clipboard.writeText(account.address);
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 1500);
  };

  const handleCopyShareUrl = async () => {
    const accountIndex = account
      ? useAppStore.getState().solanaAccounts.findIndex(
          (a) => a.address === account.address
        )
      : undefined;
    const success = await copyShareableUrl(accountIndex);
    if (success) {
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 1500);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-3xl border border-amber-200/40 bg-white p-5 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.8)] my-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {account ? (
              <>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-sm text-ink break-all">
                    {account.address}
                  </p>
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wide transition ${
                      addressCopied
                        ? 'border-green-300 bg-green-100 text-green-700'
                        : 'border-amber-200 text-steel hover:bg-amber-50'
                    }`}
                  >
                    {addressCopied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyShareUrl}
                    className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wide transition ${
                      urlCopied
                        ? 'border-blue-300 bg-blue-100 text-blue-700'
                        : 'border-amber-200 text-steel hover:bg-amber-50'
                    }`}
                    title="Copy URL to restore this session state"
                  >
                    {urlCopied ? 'URL Copied' : 'Share URL'}
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                    WalletConnect
                  </span>
                  <span className="text-xs text-steel">
                    Path {account.path.replace('m/', '')}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
                WalletConnect
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-amber-200 px-3 py-1 text-xs text-steel"
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
            <p className="mt-1 text-[10px] text-steel">
              Pasting starts pairing immediately. The URI is a secret pairing
              credential, not the message being signed. Sifar&apos;s debug and
              event entries include only sanitized pairing metadata.
            </p>
          </div>
        </div>

        <div className="mt-4 text-xs text-steel">
          {status && <p>{status}</p>}
          {(busy || signing) && <p className="mt-1">Working…</p>}
          {error && (
            <div className="mt-2 flex items-start gap-2">
              <p className="flex-1 text-ember">{error}</p>
              <button
                type="button"
                onClick={() => setError(null)}
                className="shrink-0 rounded border border-ember/30 bg-ember/10 px-2 py-0.5 text-[10px] text-ember hover:bg-ember/20"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Signing Request - show prominently when there's a request */}
        {signingRequestForWallet && signingRequestSummary && (
          error ? (
            /* Signing failed - show error state */
            <div className="mt-4 rounded-2xl border-2 border-red-400 bg-red-50 p-4 text-xs">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-700">
                Signing Failed
              </p>
              <p className="mt-2 text-sm font-semibold text-ink">
                {signingRequestSummary.title}
              </p>
              <div className="mt-2 rounded-lg border border-red-200 bg-red-100 p-2 text-red-700">
                <p className="font-medium">Error:</p>
                <p className="mt-1 break-all">{error}</p>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-blue-700 hover:bg-blue-200"
                  onClick={() => {
                    setError(null);
                  }}
                >
                  Try Again
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs uppercase tracking-wide text-red-600 hover:bg-red-100"
                  onClick={handleRejectSigning}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : (
            /* Supported signing requests */
            <div className="mt-4 rounded-2xl border-2 border-blue-400 bg-blue-50 p-4 text-xs">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-700">
                Signing Request
              </p>
              <p className="mt-2 text-sm font-semibold text-ink">
                {signingRequestSummary.title}
              </p>
              <p className="mt-1 text-steel break-all">
                {signingRequestSummary.description}
              </p>
              {signingRequestForWallet.type === 'solana_signMessage' && (
                <div className="mt-3 rounded-lg border border-blue-200 bg-white/80 p-3 text-[11px] text-blue-900">
                  <p className="font-semibold">Stable firmware OCMS v1</p>
                  <p className="mt-1">
                    Trezor signs the Solana off-chain v1 envelope and returns the
                    exact signed bytes. Sifar verifies those bytes locally before
                    replying.
                  </p>
                  <p className="mt-2 text-orange-700">
                    Compatibility note: legacy dApps that verify the signature
                    against only the raw WalletConnect message may reject this
                    standards-safe hardware signature.
                  </p>
                </div>
              )}
              <p className="mt-3 text-[10px] text-blue-600">
                Confirm on your Trezor device after clicking Sign.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-blue-700 hover:bg-blue-200"
                  onClick={handleApproveSigning}
                  disabled={signing || busy}
                >
                  {signing ? 'Signing...' : 'Sign with Trezor'}
                </button>
                <button
                  type="button"
                  className={`rounded-lg border px-3 py-1 text-xs uppercase tracking-wide ${
                    signing
                      ? 'border-orange-300 bg-orange-100 text-orange-700 hover:bg-orange-200'
                      : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                  }`}
                  onClick={handleRejectSigning}
                  disabled={busy}
                >
                  {signing ? 'Cancel' : 'Reject'}
                </button>
              </div>
            </div>
          )
        )}

        {!signingRequestForWallet && (
          <div className="mt-3 rounded-2xl border border-amber-200/60 bg-white/70 p-3 text-[11px] text-steel">
            <p className="font-semibold text-amber-700">
              Note on approvals
            </p>
            <p className="mt-1">
              Session approval does not use Trezor. Hardware confirmation only
              happens when a signing request arrives (transactions or messages).
            </p>
          </div>
        )}

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
                  console.log('[Modal] Approve clicked, proposalId:', pendingProposal.id);
                  setBusy(true);
                  setError(null);
                  try {
                    console.log('[Modal] Calling approveSessionProposal...');
                    const session = await approveSessionProposal(
                      pendingProposal.id,
                      account.address,
                      pendingProposal.params
                    );
                    console.log('[Modal] Session approved, topic:', session.topic);
                    addActiveSession({
                      topic: session.topic,
                      peerName: session.peer.metadata.name,
                      peerUrl: session.peer.metadata.url,
                      peerIcon: session.peer.metadata.icons?.[0],
                      chains: Object.keys(session.namespaces || {}),
                      walletAddress: account.address
                    });
                    addWcEvent({
                      type: 'session_approved',
                      peerName: session.peer.metadata.name,
                      topic: session.topic,
                      details: `Approved session with ${session.peer.metadata.name} for ${account.address.slice(0, 8)}...`,
                      rawParams: JSON.stringify({ topic: session.topic, namespaces: session.namespaces, peer: session.peer.metadata }, null, 2)
                    });
                    console.log('[Modal] ActiveSession added, clearing pendingProposal');
                    setPendingProposal(null);
                    setStatus(`Connected to ${session.peer.metadata.name}.`);
                    setWcUri('');
                    console.log('[Modal] Approval flow complete');
                  } catch (err: any) {
                    console.error('[Modal] Approval failed:', err);
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
                    addWcEvent({
                      type: 'session_rejected',
                      peerName: pendingProposal.proposer.name,
                      details: `Rejected session from ${pendingProposal.proposer.name}`,
                      rawParams: JSON.stringify({ proposalId: pendingProposal.id, proposer: pendingProposal.proposer }, null, 2)
                    });
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

        {sessionsForWallet.length > 0 && (
          <div className="mt-4 rounded-2xl border border-green-200 bg-green-50/60 p-4 text-xs">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-green-700">
                Active Sessions ({sessionsForWallet.length})
              </p>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    relayStatus === 'connected'
                      ? 'bg-green-500'
                      : relayStatus === 'reconnecting'
                        ? 'bg-yellow-500 animate-pulse'
                        : 'bg-red-500'
                  }`}
                />
                <span className="text-[10px] text-steel">
                  {relayStatus === 'connected'
                    ? 'Relay OK'
                    : relayStatus === 'reconnecting'
                      ? 'Reconnecting...'
                      : 'Relay Down'}
                </span>
                <button
                  type="button"
                  className={`rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                    relayStatus === 'reconnecting'
                      ? 'border-yellow-300 bg-yellow-50 text-yellow-700'
                      : 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
                  }`}
                  onClick={handleRestartRelay}
                  disabled={relayStatus === 'reconnecting'}
                >
                  {relayStatus === 'reconnecting' ? (
                    <span className="inline-block animate-spin">↻</span>
                  ) : (
                    '↻ Reconnect'
                  )}
                </button>
              </div>
            </div>
            <div className="mt-2 space-y-2">
              {sessionsForWallet.map((session) => {
                const pingState = sessionStatus[session.topic] || 'idle';
                return (
                  <div
                    key={session.topic}
                    className={`flex items-center justify-between rounded-lg border bg-white p-2 ${
                      pingState === 'ok'
                        ? 'border-green-300'
                        : pingState === 'error'
                          ? 'border-red-300'
                          : 'border-green-200'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {session.peerIcon && (
                        <img
                          src={session.peerIcon}
                          alt=""
                          className="h-6 w-6 rounded-full"
                        />
                      )}
                      <div>
                        <div className="flex items-center gap-1">
                          <p className="font-semibold text-ink">{session.peerName}</p>
                          {pingState === 'ok' && (
                            <span className="text-green-500">✓</span>
                          )}
                          {pingState === 'error' && (
                            <span className="text-red-500">✗</span>
                          )}
                          {pingState === 'pinging' && (
                            <span className="inline-block animate-spin text-yellow-500">↻</span>
                          )}
                        </div>
                        <p className="text-[10px] text-steel">{session.peerUrl}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={`rounded-lg border px-2 py-1 text-[10px] uppercase tracking-wide ${
                          pingState === 'pinging'
                            ? 'border-yellow-200 bg-yellow-50 text-yellow-600'
                            : 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100'
                        }`}
                        onClick={() => handlePingSession(session.topic)}
                        disabled={pingState === 'pinging' || busy}
                      >
                        {pingState === 'pinging' ? 'Pinging...' : 'Ping'}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[10px] uppercase tracking-wide text-red-600 hover:bg-red-100"
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await disconnectSession(session.topic);
                            removeActiveSession(session.topic);
                            setStatus(`Disconnected from ${session.peerName}.`);
                          } catch (err: any) {
                            setError(err?.message || 'Failed to disconnect.');
                          } finally {
                            setBusy(false);
                          }
                        }}
                        disabled={busy}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Manual connect button - only show if URI entered, no pending proposal, and not already processing */}
        {wcUri && !busy && wcProjectId && !pendingProposal && !status.includes('Paired') && (
          <div className="mt-4">
            <button
              type="button"
              className="rounded-lg border border-amber-200 px-3 py-1 text-xs uppercase tracking-wide text-steel"
              onClick={() => handleWcUri(wcUri)}
            >
              Connect WalletConnect
            </button>
          </div>
        )}

        {/* Event Log - CLI-like interface for security auditing */}
        <div className="mt-4">
          <button
            type="button"
            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs uppercase tracking-wide ${
              eventLogOpen
                ? 'border-gray-600 bg-gray-900 text-gray-300'
                : 'border-gray-300 bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            onClick={() => setEventLogOpen(!eventLogOpen)}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono">{'>'}</span>
              Event Log ({wcEventLog.length})
            </span>
            <span>{eventLogOpen ? '▼' : '▶'}</span>
          </button>

          {eventLogOpen && (
            <div className="mt-1 rounded-lg border border-gray-700 bg-gray-900 shadow-inner">
              <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
                <span className="font-mono text-[10px] text-gray-400">
                  WalletConnect Events — Security Audit Log
                </span>
                <button
                  type="button"
                  className="rounded border border-gray-600 px-2 py-0.5 font-mono text-[10px] text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                  onClick={() => {
                    clearWcEventLog();
                    setExpandedEvents(new Set());
                  }}
                >
                  Clear
                </button>
              </div>
              <div
                ref={eventLogRef}
                className="max-h-64 overflow-y-auto p-2 font-mono text-[11px]"
              >
                {wcEventLog.length === 0 ? (
                  <p className="py-4 text-center text-gray-500">
                    No events yet. Connect to a dApp to see events.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {wcEventLog.map((event) => {
                      const isExpanded = expandedEvents.has(event.id);
                      return (
                        <div
                          key={event.id}
                          className="rounded border border-gray-800 bg-gray-800/50"
                        >
                          <button
                            type="button"
                            className="flex w-full items-start gap-2 p-2 text-left hover:bg-gray-800"
                            onClick={() => toggleEventExpanded(event.id)}
                          >
                            <span className="shrink-0 text-gray-500">
                              {formatEventTime(event.timestamp)}
                            </span>
                            <span
                              className={`shrink-0 font-semibold ${getEventTypeColor(
                                event.type
                              )}`}
                            >
                              [{event.type.toUpperCase().replace(/_/g, ' ')}]
                            </span>
                            <span className="flex-1 truncate text-gray-300">
                              {event.details}
                            </span>
                            <span className="shrink-0 text-gray-600">
                              {isExpanded ? '▼' : '▶'}
                            </span>
                          </button>
                          {isExpanded && (
                            <div className="border-t border-gray-700 bg-gray-900 p-2">
                              <div className="grid gap-1 text-[10px]">
                                {event.peerName && (
                                  <p>
                                    <span className="text-gray-500">Peer:</span>{' '}
                                    <span className="text-green-400">
                                      {event.peerName}
                                    </span>
                                  </p>
                                )}
                                {event.method && (
                                  <p>
                                    <span className="text-gray-500">Method:</span>{' '}
                                    <span className="text-blue-400">
                                      {event.method}
                                    </span>
                                  </p>
                                )}
                                {event.topic && (
                                  <p>
                                    <span className="text-gray-500">Topic:</span>{' '}
                                    <span className="text-gray-400 break-all">
                                      {event.topic}
                                    </span>
                                  </p>
                                )}
                                {event.rawParams && (
                                  <div className="mt-2">
                                    <p className="mb-1 text-gray-500">
                                      Raw Params (for verification):
                                    </p>
                                    <pre className="max-h-48 overflow-auto rounded border border-gray-700 bg-black p-2 text-[9px] text-gray-300">
                                      {event.rawParams}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
