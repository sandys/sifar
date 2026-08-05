const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

export type WalletConnectUriInfo = {
  topic: string;
  version: 2;
  relayProtocol: string;
  expiryTimestamp: number | null;
  expiresInSeconds: number | null;
};

export function parseWalletConnectUri(
  input: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): WalletConnectUriInfo {
  const uri = input.trim();
  if (!uri) {
    throw new Error('Paste a WalletConnect URI first.');
  }
  if (/\s/.test(uri)) {
    throw new Error('WalletConnect URI must not contain spaces or line breaks.');
  }

  const match = /^wc:([^@?]+)@(\d+)\?(.+)$/.exec(uri);
  if (!match) {
    throw new Error('Invalid WalletConnect URI format.');
  }

  const [, topic, versionText, query] = match;
  if (!HEX_32_BYTES.test(topic)) {
    throw new Error('WalletConnect URI has an invalid pairing topic.');
  }
  if (versionText !== '2') {
    throw new Error('Only WalletConnect v2 pairing URIs are supported.');
  }

  const search = new URLSearchParams(query);
  const relayProtocol = search.get('relay-protocol');
  if (!relayProtocol) {
    throw new Error('WalletConnect URI is missing its relay protocol.');
  }

  const symmetricKey = search.get('symKey');
  if (!symmetricKey || !HEX_32_BYTES.test(symmetricKey)) {
    throw new Error('WalletConnect URI has an invalid symmetric key.');
  }

  const expiryText = search.get('expiryTimestamp');
  let expiryTimestamp: number | null = null;
  if (expiryText !== null) {
    expiryTimestamp = Number(expiryText);
    if (!Number.isSafeInteger(expiryTimestamp) || expiryTimestamp <= 0) {
      throw new Error('WalletConnect URI has an invalid expiry timestamp.');
    }
    if (expiryTimestamp <= nowSeconds) {
      throw new Error(
        'This WalletConnect URI has expired. Generate a fresh QR code in the dApp.'
      );
    }
  }

  return {
    topic,
    version: 2,
    relayProtocol,
    expiryTimestamp,
    expiresInSeconds:
      expiryTimestamp === null ? null : expiryTimestamp - nowSeconds
  };
}

export function getSafeWalletConnectUriLog(info: WalletConnectUriInfo) {
  return {
    topicPrefix: `${info.topic.slice(0, 8)}...`,
    version: info.version,
    relayProtocol: info.relayProtocol,
    expiryTimestamp: info.expiryTimestamp,
    expiresInSeconds: info.expiresInSeconds
  };
}
