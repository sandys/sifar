import { create } from 'zustand';
import type { WizardIntent } from './wizard';

interface DeviceInfo {
  label: string;
  model: string;
  firmwareVersion: string;
}

interface SPLToken {
  mint: string;
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  usdValue?: number;
  logoUri?: string;
}

export interface SolanaAccount {
  address: string;
  path: string;
  balance: number | null;
  tokens: SPLToken[];
  balanceStatus: 'loading' | 'ok' | 'error';
  balanceError?: string | null;
}

interface WCSession {
  topic: string;
  peerName: string;
  peerUrl: string;
  peerIcon?: string;
  chains: string[];
  walletAddress: string;
}

interface PendingProposal {
  id: number;
  params: any; // Full proposal params for buildApprovedNamespaces
  proposer: {
    name: string;
    url: string;
    description: string;
    icons?: string[];
  };
  requiredNamespaces: Record<string, unknown>;
  optionalNamespaces?: Record<string, unknown>;
}

interface PendingRequest {
  type: string;
  topic: string;
  requestId: number;
  transaction?: any;
  transactions?: any[];
  rawBytes?: Uint8Array;
  messageBytes: Uint8Array;
  // Address resolved from the transaction bytes at staging time and re-checked
  // at approval time. Never sourced from the selected-account UI state.
  signerAddress?: string;
  humanMessage?: string;
  messageText?: string;
  messageSignerAddress?: string;
  messageDerivationPath?: string;
  expectedSignedData?: Uint8Array;
  messageProtocol?: 'ocms-v1';
  sendAfterSign?: boolean;
}

interface WCEventLogEntry {
  id: string;
  timestamp: number;
  type: 'pairing_started' | 'pairing_success' | 'session_proposal' | 'session_approved' | 'session_rejected' | 'session_request' | 'request_approved' | 'request_rejected' | 'session_deleted' | 'error';
  peerName?: string;
  method?: string;
  topic?: string;
  details: string;
  rawParams?: string;
}

type StatusTone = 'info' | 'warn' | 'error';

interface AppState {
  trezorConnected: boolean;
  trezorDeviceInfo: DeviceInfo | null;
  trezorUiRequest: { type: string; payload?: any } | null;
  wcProjectId: string | null;
  solanaAddress: string | null;
  solanaDerivationPath: string;
  solanaBalance: number | null;
  splTokens: SPLToken[];
  solanaAccounts: SolanaAccount[];
  activeAccountIndex: number;
  /** True once the user has explicitly picked an account (not the index-0 default). */
  accountChosen: boolean;
  /** Explicit wizard navigation, overriding the derived step. */
  wizardIntent: WizardIntent;
  /**
   * Addresses the user has physically confirmed on the Trezor this session.
   *
   * Confirmation establishes that an address really came from the device. That
   * fact does not decay while the device stays attached, so re-selecting an
   * already-confirmed account does not re-prompt. Cleared on disconnect, and on
   * any re-enumeration, because both mean the device has to vouch again.
   */
  confirmedAddresses: string[];
  wcInitialized: boolean;
  appReady: boolean;
  activeSessions: WCSession[];
  pendingProposal: PendingProposal | null;
  pendingRequest: PendingRequest | null;
  statusMessage: string | null;
  statusTone: StatusTone;
  statusNonce: number;
  debugLogs: string[];
  wcEventLog: WCEventLogEntry[];

  setTrezorConnected: (connected: boolean) => void;
  setTrezorDeviceInfo: (info: DeviceInfo | null) => void;
  setTrezorUiRequest: (request: { type: string; payload?: any } | null) => void;
  setWcProjectId: (projectId: string | null) => void;
  setSolanaAddress: (address: string, path: string) => void;
  setSolanaBalance: (balance: number | null) => void;
  setSplTokens: (tokens: SPLToken[]) => void;
  setSolanaAccounts: (accounts: SolanaAccount[]) => void;
  setActiveAccount: (index: number) => void;
  selectAccount: (index: number) => void;
  markAddressConfirmed: (address: string) => void;
  clearConfirmedAddresses: () => void;
  setWizardIntent: (intent: WizardIntent) => void;
  openWalletConnectModal: (index: number) => void;
  setWcInitialized: (initialized: boolean) => void;
  setAppReady: (ready: boolean) => void;
  addActiveSession: (session: WCSession) => void;
  removeActiveSession: (topic: string) => void;
  getSessionsForAddress: (address: string) => WCSession[];
  setPendingProposal: (proposal: PendingProposal | null) => void;
  clearPendingProposal: () => void;
  setPendingRequest: (request: PendingRequest | null) => void;
  clearPendingRequest: () => void;
  setStatusMessage: (message: string | null) => void;
  setStatus: (message: string | null, tone?: StatusTone) => void;
  updateSolanaAccount: (index: number, update: Partial<SolanaAccount>) => void;
  refreshSolanaAccountBalance: (index: number) => Promise<void>;
  appendDebugLog: (line: string) => void;
  clearDebugLog: () => void;
  addWcEvent: (event: Omit<WCEventLogEntry, 'id' | 'timestamp'>) => void;
  clearWcEventLog: () => void;
}

function normalizeAccount(account: SolanaAccount): SolanaAccount {
  const balanceStatus =
    account.balanceStatus ||
    (account.balance === null ? 'loading' : 'ok');
  return {
    ...account,
    balanceStatus,
    balanceError: account.balanceError ?? null
  };
}

export const useAppStore = create<AppState>()((set, get) => ({
  trezorConnected: false,
  trezorDeviceInfo: null,
  trezorUiRequest: null,
  wcProjectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || null,
  solanaAddress: null,
  solanaDerivationPath: "m/44'/501'/0'/0'",
  solanaBalance: null,
  splTokens: [],
  solanaAccounts: [],
  activeAccountIndex: 0,
  accountChosen: false,
  wizardIntent: null,
  confirmedAddresses: [],
  wcInitialized: false,
  appReady: false,
  activeSessions: [],
  pendingProposal: null,
  pendingRequest: null,
  statusMessage: null,
  statusTone: 'info',
  statusNonce: 0,
  debugLogs: [],
  wcEventLog: [],

  setTrezorConnected: (connected) => set({ trezorConnected: connected }),
  setTrezorDeviceInfo: (info) => set({ trezorDeviceInfo: info }),
  setTrezorUiRequest: (request) => set({ trezorUiRequest: request }),
  setWcProjectId: (projectId) => set({ wcProjectId: projectId }),
  setSolanaAddress: (address, path) =>
    set({ solanaAddress: address, solanaDerivationPath: path }),
  setSolanaBalance: (balance) => set({ solanaBalance: balance }),
  setSplTokens: (tokens) => set({ splTokens: tokens }),
  setSolanaAccounts: (accounts) => {
    const normalized = accounts.map(normalizeAccount);
    set((state) => {
      const activeAccountIndex = Math.min(
        state.activeAccountIndex,
        Math.max(0, normalized.length - 1)
      );
      const selected = normalized[activeAccountIndex];

      return {
        solanaAccounts: normalized,
        activeAccountIndex,
        // Losing every account (disconnect) resets the wizard to step 1 rather
        // than stranding the user on a step whose preconditions are gone.
        accountChosen: normalized.length === 0 ? false : state.accountChosen,
        wizardIntent: normalized.length === 0 ? null : state.wizardIntent,
        confirmedAddresses:
          normalized.length === 0 ? [] : state.confirmedAddresses,
        solanaAddress: selected?.address ?? null,
        solanaDerivationPath: selected?.path ?? "m/44'/501'/0'/0'",
        solanaBalance: selected?.balance ?? null,
        splTokens: selected?.tokens ?? []
      };
    });
  },
  setActiveAccount: (index) => {
    const accounts = get().solanaAccounts;
    const selected = accounts[index];
    if (!selected) return;
    set({
      activeAccountIndex: index,
      solanaAddress: selected.address,
      solanaDerivationPath: selected.path,
      solanaBalance: selected.balance,
      splTokens: selected.tokens
    });
  },
  // The user explicitly picked this account. Distinct from setActiveAccount,
  // which only moves the selection; this records the decision the wizard and
  // the signing UI depend on.
  selectAccount: (index) => {
    const selected = get().solanaAccounts[index];
    if (!selected) return;
    set({
      activeAccountIndex: index,
      accountChosen: true,
      solanaAddress: selected.address,
      solanaDerivationPath: selected.path,
      solanaBalance: selected.balance,
      splTokens: selected.tokens,
      // Clearing the intent here — inside the action that changes the
      // underlying fact — is why the intent cannot desync. Never clear it from
      // an effect.
      wizardIntent: get().wizardIntent === 'accounts' ? null : get().wizardIntent
    });
  },
  setWizardIntent: (intent) => set({ wizardIntent: intent }),
  markAddressConfirmed: (address) =>
    set((state) =>
      state.confirmedAddresses.includes(address)
        ? state
        : { confirmedAddresses: [...state.confirmedAddresses, address] }
    ),
  clearConfirmedAddresses: () => set({ confirmedAddresses: [] }),
  // Kept under its original name because it is the app's one entry point into
  // the WalletConnect linking surface. It no longer mutates account state as a
  // side effect of opening a panel: it selects, then navigates.
  openWalletConnectModal: (index) => {
    get().selectAccount(index);
    set({ wizardIntent: 'link' });
  },
  setWcInitialized: (initialized) => set({ wcInitialized: initialized }),
  setAppReady: (ready) => set({ appReady: ready }),
  addActiveSession: (session) =>
    set((state) => ({
      activeSessions: [
        ...state.activeSessions.filter((s) => s.topic !== session.topic),
        session
      ],
      // The reason the user was on the link step is now satisfied, so drop the
      // override and let the derived step move them to Home.
      wizardIntent:
        state.wizardIntent === 'link' &&
        session.walletAddress === state.solanaAddress
          ? null
          : state.wizardIntent
    })),
  removeActiveSession: (topic) =>
    set((state) => ({
      activeSessions: state.activeSessions.filter((s) => s.topic !== topic)
    })),
  getSessionsForAddress: (address) =>
    get().activeSessions.filter((s) => s.walletAddress === address),
  setPendingProposal: (proposal) => set({ pendingProposal: proposal }),
  clearPendingProposal: () => set({ pendingProposal: null }),
  setPendingRequest: (request) => set({ pendingRequest: request }),
  clearPendingRequest: () => set({ pendingRequest: null }),
  setStatusMessage: (message) => get().setStatus(message, 'info'),
  // statusNonce lets the toast re-show an identical message (e.g. the same
  // rate-limit warning twice) instead of appearing stuck.
  setStatus: (message, tone = 'info') =>
    set((state) => ({
      statusMessage: message,
      statusTone: tone,
      statusNonce: state.statusNonce + 1
    })),
  updateSolanaAccount: (index, update) =>
    set((state) => {
      const accounts = [...state.solanaAccounts];
      if (!accounts[index]) return state;
      const nextAccount = normalizeAccount({
        ...accounts[index],
        ...update
      });
      accounts[index] = nextAccount;
      const updates: Partial<AppState> = { solanaAccounts: accounts };
      if (index === state.activeAccountIndex) {
        updates.solanaAddress = nextAccount.address;
        updates.solanaDerivationPath = nextAccount.path;
        updates.solanaBalance = nextAccount.balance;
        updates.splTokens = nextAccount.tokens;
      }
      return updates as AppState;
    }),
  refreshSolanaAccountBalance: async (index) => {
    const { solanaAccounts } = get();
    const account = solanaAccounts[index];
    if (!account) return;
    set((state) => {
      const accounts = [...state.solanaAccounts];
      if (!accounts[index]) return state;
      accounts[index] = {
        ...accounts[index],
        balanceStatus: 'loading',
        balanceError: null
      };
      return { solanaAccounts: accounts } as AppState;
    });
    // The account list can be replaced while this request is in flight (a
    // reconnect into a passphrase wallet, a re-enumeration). Writing back by
    // index alone would paint the old wallet's balance onto a new address.
    const stillSameAccount = () =>
      get().solanaAccounts[index]?.address === account.address;

    try {
      const { getAllBalances } = await import('./solana');
      const { sol, tokens } = await getAllBalances(account.address);
      if (!stillSameAccount()) return;
      get().updateSolanaAccount(index, {
        balance: sol,
        tokens,
        balanceStatus: 'ok',
        balanceError: null
      });
    } catch (err: any) {
      if (!stillSameAccount()) return;
      get().updateSolanaAccount(index, {
        balance: null,
        tokens: [],
        balanceStatus: 'error',
        balanceError: err?.message || 'Balance failed'
      });
    }
  },
  appendDebugLog: (line) =>
    set((state) => {
      const next = [...state.debugLogs, line].slice(-500);
      return { debugLogs: next };
    }),
  clearDebugLog: () => set({ debugLogs: [] }),
  addWcEvent: (event) =>
    set((state) => {
      const entry: WCEventLogEntry = {
        ...event,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now()
      };
      const next = [entry, ...state.wcEventLog].slice(0, 100); // Keep last 100 events
      return { wcEventLog: next };
    }),
  clearWcEventLog: () => set({ wcEventLog: [] })
}));
