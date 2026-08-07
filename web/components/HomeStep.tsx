'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { DebugPanel } from '@/components/DebugPanel';
import { shortenAddress, accountLabelFromPath } from '@/lib/format';
import {
  disconnectSession,
  getRelayConnectionState,
  pingSession,
  restartRelay
} from '@/lib/walletconnect';

interface HomeStepProps {
  deviceInfo: { label: string; model: string; firmwareVersion: string } | null;
  /** Label kept in the parent so the wizard owns its own navigation copy. */
  linkLabel?: string;
  onLinkAnother: () => void;
  onDisconnect: () => void;
}

/** Home: the steady state once an account is linked to at least one dApp. */
export function HomeStep({
  deviceInfo,
  linkLabel = 'Link another dApp',
  onLinkAnother,
  onDisconnect
}: HomeStepProps) {
  const solanaAddress = useAppStore((state) => state.solanaAddress);
  const solanaDerivationPath = useAppStore((state) => state.solanaDerivationPath);
  const solanaBalance = useAppStore((state) => state.solanaBalance);
  const activeSessions = useAppStore((state) => state.activeSessions);
  const removeActiveSession = useAppStore((state) => state.removeActiveSession);
  const setWizardIntent = useAppStore((state) => state.setWizardIntent);
  const setStatus = useAppStore((state) => state.setStatus);
  const wcEventLog = useAppStore((state) => state.wcEventLog);

  const [relayStatus, setRelayStatus] = useState<string>('unknown');
  const [pingState, setPingState] = useState<Record<string, string>>({});
  const [sessionError, setSessionError] = useState<Record<string, string>>({});
  const [debugOpen, setDebugOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const sessions = useMemo(
    () => activeSessions.filter((s) => s.walletAddress === solanaAddress),
    [activeSessions, solanaAddress]
  );

  useEffect(() => {
    setRelayStatus(getRelayConnectionState());
  }, [activeSessions.length]);

  const handlePing = async (topic: string) => {
    setPingState((prev) => ({ ...prev, [topic]: 'pinging' }));
    const ok = await pingSession(topic);
    setPingState((prev) => ({ ...prev, [topic]: ok ? 'ok' : 'error' }));
  };

  const handleDisconnectSession = async (topic: string, peerName: string) => {
    setBusy(true);
    setSessionError((prev) => {
      const next = { ...prev };
      delete next[topic];
      return next;
    });
    try {
      await disconnectSession(topic);
      removeActiveSession(topic);
      setStatus(`Disconnected from ${peerName}.`);
    } catch (err: any) {
      console.error('[Home] Disconnect failed:', err);
      setSessionError((prev) => ({
        ...prev,
        [topic]: err?.message || 'Failed to disconnect.'
      }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-4">
      <div className="rounded-3xl border border-amber-200/60 bg-white/80 p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-steel">
          Active account
        </p>
        <p className="mt-1 font-mono text-lg text-ink">
          {shortenAddress(solanaAddress || '', 8, 8)}
        </p>
        <p className="mt-1 text-sm text-steel">
          {accountLabelFromPath(solanaDerivationPath)} ·{' '}
          {solanaBalance === null ? '…' : `${solanaBalance} SOL`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3"
          onClick={() => setWizardIntent('accounts')}
        >
          Change account
        </Button>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">
            Connected dApps ({sessions.length})
          </h2>
          <span className="text-sm text-steel">
            {relayStatus === 'connected' ? 'Relay OK' : `Relay ${relayStatus}`}
          </span>
        </div>

        {sessions.length === 0 && (
          <p className="rounded-2xl border border-amber-200 bg-white/70 px-4 py-6 text-center text-sm text-steel">
            No dApps connected to this account yet.
          </p>
        )}

        {sessions.map((session) => (
          <div
            key={session.topic}
            className="rounded-2xl border border-amber-200 bg-white/80 p-4"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-ink">
                  {session.peerName}
                </p>
                <p className="truncate text-sm text-steel">{session.peerUrl}</p>
                {sessionError[session.topic] && (
                  <p className="mt-1 break-words text-sm text-ember">
                    {sessionError[session.topic]}
                  </p>
                )}
              </div>
              {pingState[session.topic] === 'ok' && (
                <span className="text-moss" aria-label="Session responded">
                  ✓
                </span>
              )}
              {pingState[session.topic] === 'error' && (
                <span className="text-ember" aria-label="Session did not respond">
                  ✗
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handlePing(session.topic)}
                disabled={pingState[session.topic] === 'pinging'}
              >
                {pingState[session.topic] === 'pinging' ? 'Pinging…' : 'Ping'}
              </Button>
              {/* Disconnect stays visually loud on purpose — it must never be
                  a ghost button, and lint enforces that. */}
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  handleDisconnectSession(session.topic, session.peerName)
                }
              >
                Disconnect
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Button size="lg" fullWidth onClick={onLinkAnother}>
        {linkLabel}
      </Button>

      {relayStatus !== 'connected' && (
        <Button
          variant="ghost"
          fullWidth
          onClick={async () => {
            setRelayStatus('reconnecting');
            try {
              await restartRelay();
              setRelayStatus('connected');
            } catch {
              setRelayStatus('disconnected');
            }
          }}
        >
          Reconnect relay
        </Button>
      )}

      {deviceInfo && (
        <p className="text-center text-sm text-steel">
          {deviceInfo.label} · {deviceInfo.model} · {deviceInfo.firmwareVersion}
        </p>
      )}

      <div className="grid gap-2">
        <Button variant="ghost" size="sm" onClick={() => setLogOpen(true)}>
          Event log ({wcEventLog.length})
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDebugOpen(true)}>
          Diagnostics
        </Button>
        <Button variant="danger" fullWidth onClick={onDisconnect}>
          Disconnect Trezor
        </Button>
      </div>

      <Sheet
        open={debugOpen}
        title="Diagnostics"
        onClose={() => setDebugOpen(false)}
      >
        <DebugPanel />
      </Sheet>

      <Sheet open={logOpen} title="Event log" onClose={() => setLogOpen(false)}>
        <div className="grid gap-2">
          {wcEventLog.length === 0 && (
            <p className="text-sm text-steel">No events yet.</p>
          )}
          {wcEventLog.map((event) => (
            <div
              key={event.id}
              className="rounded-xl border border-amber-100 bg-white p-3"
            >
              <p className="text-xs uppercase tracking-wide text-steel">
                {event.type}
              </p>
              <p className="mt-1 break-words text-sm text-ink">
                {event.details}
              </p>
            </div>
          ))}
        </div>
      </Sheet>
    </section>
  );
}
