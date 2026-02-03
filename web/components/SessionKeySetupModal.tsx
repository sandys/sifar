'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import {
  generateSessionKey,
  createAttestationTransaction,
  storeSessionKey,
  signWithSessionKey,
  loadSessionKey,
  clearSessionKey
} from '@/lib/sessionKey';
import { signSolanaTransaction } from '@/lib/trezor';
import { respondToSessionKeyMessage } from '@/lib/signing';
import { Buffer } from 'buffer';

interface SessionKeySetupModalProps {
  authority: string;
  pendingMessage?: Uint8Array;
  pendingRequestId?: number;
  pendingTopic?: string;
  onComplete: () => void;
  onCancel: () => void;
}

export function SessionKeySetupModal({
  authority,
  pendingMessage,
  pendingRequestId,
  pendingTopic,
  onComplete,
  onCancel
}: SessionKeySetupModalProps) {
  const [step, setStep] = useState<'intro' | 'creating' | 'signing' | 'done'>('intro');
  const [expiresIn, setExpiresIn] = useState(24); // hours
  const [error, setError] = useState<string | null>(null);

  const solanaAccounts = useAppStore((state) => state.solanaAccounts);
  const setSessionKey = useAppStore((state) => state.setSessionKey);
  const matchingAccount = solanaAccounts.find(a => a.address === authority);

  // Guard against hydration issues
  useEffect(() => {
    if (typeof window === 'undefined') return;
  }, []);

  const handleCreateSessionKey = async () => {
    if (!matchingAccount) {
      setError('No matching account found');
      return;
    }

    setStep('creating');
    setError(null);

    try {
      // 1. Generate ephemeral keypair
      const sessionKeypair = generateSessionKey();
      const expiresAt = Date.now() + (expiresIn * 60 * 60 * 1000);

      console.log('[Sifar] Creating session key:', {
        sessionPublicKey: sessionKeypair.publicKey.slice(0, 16) + '...',
        authority: authority.slice(0, 16) + '...',
        expiresAt: new Date(expiresAt).toISOString()
      });

      // 2. Create attestation transaction (memo with delegation info)
      const attestationTx = await createAttestationTransaction(
        authority,
        sessionKeypair.publicKey,
        expiresAt
      );

      setStep('signing');

      // 3. Sign attestation tx with Trezor
      console.log('[Sifar] Requesting Trezor signature for attestation...');
      const messageBytes = attestationTx.serializeMessage();
      const { signature: hexSig } = await signSolanaTransaction(
        messageBytes,
        matchingAccount.path
      );

      // 4. Add signature to transaction
      const sigBytes = Buffer.from(hexSig, 'hex');
      attestationTx.addSignature(
        attestationTx.feePayer!,
        sigBytes
      );

      // 5. Serialize the signed transaction
      const signedTxBase64 = Buffer.from(attestationTx.serialize()).toString('base64');

      // 6. Store session key
      const fullSessionKey = {
        publicKey: sessionKeypair.publicKey,
        secretKey: sessionKeypair.secretKey,
        authority,
        expiresAt,
        attestationTx: signedTxBase64
      };

      storeSessionKey(fullSessionKey);

      // Update store with session key info
      setSessionKey({
        publicKey: sessionKeypair.publicKey,
        authority,
        expiresAt,
        hasAttestation: true
      });

      console.log('[Sifar] Session key created and stored');

      // 7. If there's a pending message, sign it now
      if (pendingMessage && pendingRequestId && pendingTopic) {
        const sessionKey = loadSessionKey(authority);
        if (sessionKey) {
          console.log('[Sifar] Signing pending message with session key...');
          const { signature, proof } = signWithSessionKey(sessionKey, pendingMessage);

          // Respond to WalletConnect
          await respondToSessionKeyMessage(
            pendingTopic,
            pendingRequestId,
            signature,
            proof.sessionKey,
            proof.attestationTx
          );
          console.log('[Sifar] Message signed and response sent');
        }
      }

      setStep('done');
      onComplete();

    } catch (err: any) {
      console.error('[Sifar] Session key creation failed:', err);
      setError(err?.message || 'Failed to create session key');
      setStep('intro');
    }
  };

  const handleClearSessionKey = () => {
    clearSessionKey(authority);
    setSessionKey(null);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-4">
      <div className="w-full max-w-md rounded-2xl border border-blue-200 bg-white p-5 shadow-xl">
        {step === 'intro' && (
          <>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-700">
              Delegated Signing (Experimental)
            </h3>
            <p className="mt-3 text-xs text-steel">
              Create a temporary session key that can sign messages.
              Your Trezor will authorize this by signing a transaction (not broadcast).
            </p>

            <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-[11px] text-orange-800">
              <p className="font-semibold">Important Limitations</p>
              <ul className="mt-1 list-disc pl-4 space-y-1">
                <li>Signature comes from session key, not your Trezor address</li>
                <li>Most dApps (pump.fun, etc.) will reject this signature</li>
                <li>Only works with dApps that support delegated signing</li>
              </ul>
            </div>

            <div className="mt-4">
              <label className="text-xs font-semibold text-steel">Session expires in:</label>
              <select
                className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs"
                value={expiresIn}
                onChange={(e) => setExpiresIn(Number(e.target.value))}
              >
                <option value={1}>1 hour</option>
                <option value={24}>24 hours</option>
                <option value={168}>1 week</option>
              </select>
            </div>

            {error && (
              <div className="mt-3 flex items-start gap-2">
                <p className="flex-1 text-xs text-red-600">{error}</p>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="shrink-0 rounded border border-red-200 px-2 py-0.5 text-[10px] text-red-600 hover:bg-red-50"
                >
                  Dismiss
                </button>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded-lg border border-blue-300 bg-blue-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-700 hover:bg-blue-200"
                onClick={handleCreateSessionKey}
              >
                Create Session Key
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-200 px-4 py-2 text-xs uppercase tracking-wide text-steel hover:bg-gray-50"
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {step === 'creating' && (
          <div className="py-8 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <p className="mt-4 text-xs text-steel">Creating session key...</p>
          </div>
        )}

        {step === 'signing' && (
          <div className="py-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-700">
              Confirm on Trezor
            </h3>
            <p className="mt-3 text-xs text-steel">
              Check your Trezor device and confirm the delegation transaction.
              This transaction will NOT be broadcast - it only authorizes the session key.
            </p>
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
              <p className="font-semibold">You should see on Trezor:</p>
              <p className="mt-1 font-mono text-[10px] break-all">
                Sifar Session Key Delegation v1
              </p>
            </div>
            <div className="mt-4 flex items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
