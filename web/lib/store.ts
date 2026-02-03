import { create } from 'zustand';

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

interface SolanaAccount {
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
  humanMessage?: string;
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

interface AppState {
  trezorConnected: boolean;
  trezorDeviceInfo: DeviceInfo | null;
  trezorUiRequest: { type: string; payload?: any } | null;
  passphraseOnDeviceOnly: boolean;
  wcAutoApproveAddress: string | null;
  wcProjectId: string | null;
  solanaAddress: string | null;
  solanaDerivationPath: string;
  solanaBalance: number | null;
  splTokens: SPLToken[];
  solanaAccounts: SolanaAccount[];
  activeAccountIndex: number;
  wcInitialized: boolean;
  appReady: boolean;
  activeSessions: WCSession[];
  pendingProposal: PendingProposal | null;
  pendingRequest: PendingRequest | null;
  statusMessage: string | null;
  debugLogs: string[];
  wcEventLog: WCEventLogEntry[];

  setTrezorConnected: (connected: boolean) => void;
  setTrezorDeviceInfo: (info: DeviceInfo | null) => void;
  setTrezorUiRequest: (request: { type: string; payload?: any } | null) => void;
  setPassphraseOnDeviceOnly: (enabled: boolean) => void;
  setWcAutoApproveAddress: (address: string | null) => void;
  setWcProjectId: (projectId: string | null) => void;
  setSolanaAddress: (address: string, path: string) => void;
  setSolanaBalance: (balance: number | null) => void;
  setSplTokens: (tokens: SPLToken[]) => void;
  setSolanaAccounts: (accounts: SolanaAccount[]) => void;
  setActiveAccount: (index: number) => void;
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
  passphraseOnDeviceOnly: false,
  wcAutoApproveAddress: null,
  wcProjectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || null,
  solanaAddress: null,
  solanaDerivationPath: "m/44'/501'/0'/0'",
  solanaBalance: null,
  splTokens: [],
  solanaAccounts: [],
  activeAccountIndex: 0,
  wcInitialized: false,
  appReady: false,
  activeSessions: [],
  pendingProposal: null,
  pendingRequest: null,
  statusMessage: null,
  debugLogs: [],
  wcEventLog: [],

  setTrezorConnected: (connected) => set({ trezorConnected: connected }),
  setTrezorDeviceInfo: (info) => set({ trezorDeviceInfo: info }),
  setTrezorUiRequest: (request) => set({ trezorUiRequest: request }),
  setPassphraseOnDeviceOnly: (enabled) =>
    set({ passphraseOnDeviceOnly: enabled }),
  setWcAutoApproveAddress: (address) => set({ wcAutoApproveAddress: address }),
  setWcProjectId: (projectId) => set({ wcProjectId: projectId }),
  setSolanaAddress: (address, path) =>
    set({ solanaAddress: address, solanaDerivationPath: path }),
  setSolanaBalance: (balance) => set({ solanaBalance: balance }),
  setSplTokens: (tokens) => set({ splTokens: tokens }),
  setSolanaAccounts: (accounts) => {
    const normalized = accounts.map(normalizeAccount);
    const first = normalized[0];
    set({
      solanaAccounts: normalized,
      activeAccountIndex: 0,
      solanaAddress: first?.address ?? null,
      solanaDerivationPath: first?.path ?? "m/44'/501'/0'/0'",
      solanaBalance: first?.balance ?? null,
      splTokens: first?.tokens ?? []
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
  setWcInitialized: (initialized) => set({ wcInitialized: initialized }),
  setAppReady: (ready) => set({ appReady: ready }),
  addActiveSession: (session) =>
    set((state) => ({
      activeSessions: [
        ...state.activeSessions.filter((s) => s.topic !== session.topic),
        session
      ]
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
  setStatusMessage: (message) => set({ statusMessage: message }),
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
    try {
      const { getAllBalances } = await import('./solana');
      const { sol, tokens } = await getAllBalances(account.address);
      get().updateSolanaAccount(index, {
        balance: sol,
        tokens,
        balanceStatus: 'ok',
        balanceError: null
      });
    } catch (err: any) {
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
