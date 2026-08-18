import type { WalletConnectUriInfo } from './walletConnectUri';

export type DisclosureLevel =
  | 'not-signing'
  | 'signing'
  | 'signing-and-sending';

export interface ActionDisclosure {
  level: DisclosureLevel;
  badge: string;
  title: string;
  summary: string;
  happens: string;
  shared: string[];
  agreement: string;
  primaryLabel: string;
}

export function accountDiscoveryDisclosure(
  rescan = false
): ActionDisclosure {
  return {
    level: 'not-signing',
    badge: 'Not signing',
    title: rescan ? 'Re-scan public accounts' : 'Connect and read accounts',
    summary:
      'This reads public wallet information. It cannot create a signature or move funds.',
    happens: rescan
      ? 'Sifar asks the attached Trezor for its supported Solana public addresses again.'
      : 'Chrome asks you to choose a USB device, then Sifar reads up to 200 supported Solana public addresses from it.',
    shared: [
      'The public addresses are held in this tab and sent through Sifar\'s server-side Solana RPC proxy to fetch balances.',
      'No private key, PIN, passphrase, or signature is sent to a dApp or RPC provider.'
    ],
    agreement:
      'Continue only if you want this site to read and display the Trezor wallet\'s public Solana accounts.',
    primaryLabel: rescan ? 'Re-scan Accounts' : 'Choose Trezor and Continue'
  };
}

export function addressVerificationDisclosure(params: {
  address: string;
  path: string;
}): ActionDisclosure {
  return {
    level: 'not-signing',
    badge: 'Not signing',
    title: 'Verify this public address',
    summary:
      'The Trezor will display the address so you can verify the account Sifar is selecting.',
    happens: `The device derives ${params.path} and displays ${params.address}. Sifar compares the returned address with the one shown here.`,
    shared: [
      'Nothing is sent to a dApp during this step.',
      'After verification, this public address becomes the account available for a later WalletConnect proposal.'
    ],
    agreement:
      'Continue only if you are ready to compare and physically confirm this public address on the Trezor.',
    primaryLabel: 'Display Address on Trezor'
  };
}

export function walletConnectPairingDisclosure(
  info: WalletConnectUriInfo
): ActionDisclosure {
  const expiry =
    info.expiresInSeconds === null
      ? 'The pairing URI did not provide an expiry time.'
      : `The pairing URI expires in about ${Math.max(
          1,
          Math.ceil(info.expiresInSeconds / 60)
        )} minute(s).`;

  return {
    level: 'not-signing',
    badge: 'Not signing',
    title: 'Open WalletConnect pairing',
    summary:
      'Pairing creates a communication channel. It does not connect an account or authorize a signature yet.',
    happens: `Sifar contacts the WalletConnect ${info.relayProtocol} relay and waits for the dApp to identify itself and request a session. ${expiry}`,
    shared: [
      'The relay receives WalletConnect pairing traffic. Your Solana address is not included in this step.',
      'The URI\'s secret stays in this tab, is not repeated in this disclosure or logs, and is cleared after pairing starts or you cancel.'
    ],
    agreement:
      'Continue only if this URI came from the dApp you intend to connect. You will review a separate session proposal next.',
    primaryLabel: 'Create Pairing'
  };
}

export function sessionProposalDisclosure(params: {
  dappName: string;
  address: string;
  chains: string[];
  methods: string[];
}): ActionDisclosure {
  const chains = params.chains.length
    ? params.chains.join(', ')
    : 'the requested Solana namespace';
  const methods = params.methods.length
    ? params.methods.join(', ')
    : 'no signing methods';

  return {
    level: 'not-signing',
    badge: 'Not signing',
    title: `Connect to ${params.dappName}`,
    summary:
      'Approving shares a public address and grants request permissions. It does not create a signature or move funds.',
    happens: `A WalletConnect session is created for ${chains}. The dApp may later request: ${methods}.`,
    shared: [
      `The dApp receives the public address ${params.address}.`,
      'The dApp also receives Sifar\'s supported chain, methods, events, and wallet metadata.'
    ],
    agreement:
      'Approve only if the displayed dApp domain is correct and you want it to send future requests for this account.',
    primaryLabel: 'Share Address and Connect'
  };
}

export function signingRequestDisclosure(params: {
  type: string;
  transactionCount?: number;
}): ActionDisclosure {
  switch (params.type) {
    case 'solana_signMessage':
      return {
        level: 'signing',
        badge: 'Will sign',
        title: 'Sign this message',
        summary:
          'This creates cryptographic proof that the selected account approved the displayed message.',
        happens:
          'Trezor wraps the text in the Solana OCMS v1 envelope, displays it for physical confirmation, and signs the exact verified bytes.',
        shared: [
          'The dApp receives the signature, the signed OCMS envelope, and the message-version marker.',
          'This does not directly submit a transaction or move funds, but the signature can prove account control or agreement.'
        ],
        agreement:
          'Sign only if you recognize the dApp and agree to the complete message shown here and on the Trezor.',
        primaryLabel: 'Sign Message with Trezor'
      };
    case 'solana_signAllTransactions':
      return {
        level: 'signing',
        badge: 'Will sign',
        title: 'Sign multiple transactions',
        summary: `This request contains ${
          params.transactionCount ?? 0
        } transactions. Each signature can authorize a separate Solana action.`,
        happens:
          'Sifar sends each unchanged transaction to the Trezor in order. The device requires its own review and confirmation for every signature.',
        shared: [
          'The dApp receives every signed transaction after all device confirmations succeed.',
          'The dApp may broadcast those transactions, which can move funds or change on-chain state.'
        ],
        agreement:
          'Continue only if you intend to review and approve every transaction in this batch on the Trezor.',
        primaryLabel: 'Review Batch on Trezor'
      };
    case 'solana_signAndSendTransaction':
      return {
        level: 'signing-and-sending',
        badge: 'Will sign and broadcast',
        title: 'Sign and send transaction',
        summary:
          'This authorizes a Solana transaction and broadcasts it after hardware signing.',
        happens:
          'The unchanged transaction is displayed and signed on the Trezor. Sifar then submits the signed bytes to the configured Solana RPC.',
        shared: [
          'The Solana RPC receives the signed transaction, and the dApp receives the resulting transaction signature.',
          'Broadcasting can move funds, spend fees, or change on-chain state.'
        ],
        agreement:
          'Continue only if you agree to both signing the complete transaction and immediately broadcasting it.',
        primaryLabel: 'Sign and Broadcast with Trezor'
      };
    default:
      return {
        level: 'signing',
        badge: 'Will sign',
        title: 'Sign transaction',
        summary:
          'This creates a signature authorizing the complete Solana transaction shown for review.',
        happens:
          'Sifar sends the unchanged transaction bytes to the Trezor. The device displays its own authoritative review before signing.',
        shared: [
          'The dApp receives the signed transaction and signature.',
          'The dApp may broadcast it, which can move funds, spend fees, or change on-chain state.'
        ],
        agreement:
          'Sign only if the complete transaction shown here and on the Trezor matches what you intend.',
        primaryLabel: 'Sign Transaction with Trezor'
      };
  }
}
