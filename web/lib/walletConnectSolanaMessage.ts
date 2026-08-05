import {
  decodeSolanaPublicKey,
  decodeWalletConnectMessage,
  serializeSolanaOffchainMessageV1
} from './solanaOffchainMessage';

type HardwareAccount = {
  address: string;
  path: string;
};

type PreparedWalletConnectMessage = {
  messageBytes: Uint8Array;
  messageText: string;
  signerAddress: string;
  derivationPath: string;
  expectedSignedData: Uint8Array;
};

export function prepareWalletConnectSolanaMessage(
  params: unknown,
  sessionWalletAddress: string,
  accounts: HardwareAccount[]
): PreparedWalletConnectMessage {
  if (!params || typeof params !== 'object') {
    throw new Error('WalletConnect message parameters must be an object');
  }
  const request = params as Record<string, unknown>;
  const signerAddress = request.pubkey;
  if (typeof signerAddress !== 'string') {
    throw new Error('WalletConnect request is missing the Solana signer');
  }
  if (sessionWalletAddress !== signerAddress) {
    throw new Error(
      'WalletConnect requested a signer that does not match the connected account'
    );
  }

  const account = accounts.find((item) => item.address === signerAddress);
  if (!account) {
    throw new Error('Requested signer is not an account loaded from this Trezor');
  }

  const { bytes: messageBytes, text: messageText } =
    decodeWalletConnectMessage(request.message);
  const signerPublicKey = decodeSolanaPublicKey(signerAddress);
  return {
    messageBytes,
    messageText,
    signerAddress,
    derivationPath: account.path,
    expectedSignedData: serializeSolanaOffchainMessageV1(messageText, [
      signerPublicKey
    ])
  };
}
