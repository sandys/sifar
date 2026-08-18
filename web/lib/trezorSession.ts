export const PASSPHRASE_ENTRY_CAPABILITY = 17;

export function supportsOnDevicePassphrase(features: unknown): boolean {
  const capabilities = (features as { capabilities?: unknown } | null)
    ?.capabilities;
  if (!Array.isArray(capabilities)) return false;

  return capabilities.some(
    (capability) =>
      capability === PASSPHRASE_ENTRY_CAPABILITY ||
      capability === 'Capability_PassphraseEntry'
  );
}

export function isLegacyOnDevicePassphraseRequest(message: unknown): boolean {
  const request = message as
    | { _on_device?: unknown; on_device?: unknown }
    | null;
  return request?._on_device === true || request?.on_device === true;
}

export function normalizeDeviceSessionId(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 &&
      normalized.length % 2 === 0 &&
      /^[0-9a-f]+$/.test(normalized)
      ? normalized
      : null;
  }

  if (value instanceof Uint8Array && value.length > 0) {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    );
  }

  return null;
}

export function getResumableDeviceSessionId(
  sessionId: string | null
): string | null {
  // @trezor/protobuf represents decoded bytes as hex strings and its encoder
  // accepts that same representation. Keep the round trip lossless rather
  // than passing a browser byte array through an undocumented input shape.
  return normalizeDeviceSessionId(sessionId);
}
