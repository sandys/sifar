const SOLANA_SIGN_MESSAGE_TYPE = 906;
const SOLANA_MESSAGE_SIGNATURE_TYPE = 907;

type ProtobufJson = {
  nested?: Record<string, any>;
};

type FirmwareFeatures = {
  major_version?: number;
  minor_version?: number;
  patch_version?: number;
};

export function getFirmwareVersion(features: FirmwareFeatures | null): string {
  if (!features) return 'unknown';
  const { major_version, minor_version, patch_version } = features;
  if (
    !Number.isInteger(major_version) ||
    !Number.isInteger(minor_version) ||
    !Number.isInteger(patch_version)
  ) {
    return 'unknown';
  }
  return `${major_version}.${minor_version}.${patch_version}`;
}

export function supportsStableSolanaOcmsV1(
  features: FirmwareFeatures | null
): boolean {
  if (!features) return false;
  const version = [
    features.major_version,
    features.minor_version,
    features.patch_version
  ];
  if (!version.every(Number.isInteger)) return false;
  const [major, minor, patch] = version as [number, number, number];
  return major > 2 ||
    (major === 2 && (minor > 12 || (minor === 12 && patch >= 4)));
}

/**
 * The published protobuf package predates Solana OCMS. Add the exact schema
 * used by current stable Core firmware without mutating the imported JSON.
 */
export function addStableSolanaMessageDefinitions(
  source: ProtobufJson
): ProtobufJson {
  const messages = JSON.parse(JSON.stringify(source)) as ProtobufJson;
  const nested = messages.nested;
  if (!nested?.MessageType?.values) {
    throw new Error('Invalid Trezor protobuf schema');
  }

  nested.SolanaOffchainMessageV1 = {
    fields: {
      message: { rule: 'required', type: 'string', id: 1 },
      signers: { rule: 'repeated', type: 'bytes', id: 2 }
    }
  };
  nested.SolanaSignMessage = {
    fields: {
      address_n: {
        rule: 'repeated',
        type: 'uint32',
        id: 1,
        options: { packed: false }
      },
      chunkify: { type: 'bool', id: 3 },
      message: {
        rule: 'required',
        type: 'SolanaOffchainMessageV1',
        id: 4
      }
    }
  };
  nested.SolanaMessageSignature = {
    fields: {
      signature: { rule: 'required', type: 'bytes', id: 1 },
      signed_data: { type: 'bytes', id: 2 }
    }
  };
  nested.MessageType.values.SolanaSignMessage = SOLANA_SIGN_MESSAGE_TYPE;
  nested.MessageType.values.SolanaMessageSignature =
    SOLANA_MESSAGE_SIGNATURE_TYPE;

  return messages;
}

export {
  SOLANA_SIGN_MESSAGE_TYPE,
  SOLANA_MESSAGE_SIGNATURE_TYPE
};
