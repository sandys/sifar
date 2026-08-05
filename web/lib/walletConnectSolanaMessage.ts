import {
  decodeSolanaPublicKey,
  decodeWalletConnectMessage,
  serializeSolanaOffchainMessageV1
} from './solanaOffchainMessage';

type HardwareAccount = {
  address: string;
  path: string;
};

/**
 * Characters @trezor/protobuf silently rewrites in string fields (it maps
 * typographic quotes to ASCII before encoding).
 *
 * The device would therefore sign different bytes than the dApp asked for, and
 * the local signed_data comparison would fail afterwards with an error that
 * blames the firmware. Detect it here so the dApp gets an accurate rejection
 * before anyone touches the device. Normalizing instead is not an option: this
 * wallet never alters what it was asked to sign.
 */
const PROTOBUF_REWRITTEN_CHARS = /[‘’]/;

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

  if (PROTOBUF_REWRITTEN_CHARS.test(messageText)) {
    throw new Error(
      'Message contains a typographic quote (‘ or ’) that the Trezor ' +
        'protobuf encoder rewrites to ASCII, so the device would sign different ' +
        'bytes than requested. Ask the dApp to use a straight quote.'
    );
  }

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
