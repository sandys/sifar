import { describe, it, expect } from 'vitest';
import {
  accountLabelFromPath,
  formatRawUnits,
  formatUnits,
  groupDigits,
  shortenAddress
} from './format';

describe('formatUnits', () => {
  it('places the decimal point without floating point', () => {
    expect(formatUnits(1_500_000_000n, 9)).toBe('1.5');
    expect(formatUnits(1n, 9)).toBe('0.000000001');
    expect(formatUnits(0n, 6)).toBe('0');
  });

  it('keeps full precision past Number.MAX_SAFE_INTEGER', () => {
    // 2^53 lands around 9_007_199 tokens at 9 decimals — inside real balances.
    const raw = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    expect(formatUnits(raw, 9)).toBe('9007199.254740993');
    // The bug this guards against:
    expect(Number(raw).toString()).not.toBe('9007199254740993');
  });

  it('strips trailing zeros but keeps significant ones', () => {
    expect(formatUnits(1_230_000_000n, 9)).toBe('1.23');
    expect(formatUnits(1_000_000_000n, 9)).toBe('1');
    expect(formatUnits(1_000_000_001n, 9)).toBe('1.000000001');
  });

  it('handles zero and negative decimals', () => {
    expect(formatUnits(42n, 0)).toBe('42');
    expect(formatUnits(-1_500_000n, 6)).toBe('-1.5');
  });
});

describe('groupDigits', () => {
  it('groups the integer part only', () => {
    expect(groupDigits('1234567.891')).toBe('1,234,567.891');
    expect(groupDigits('-1234567')).toBe('-1,234,567');
    expect(groupDigits('999')).toBe('999');
  });
});

describe('formatRawUnits', () => {
  it('labels unknown-decimal amounts so they cannot read as a token amount', () => {
    expect(formatRawUnits(12_345_678n)).toBe('12,345,678 base units');
  });
});

describe('shortenAddress', () => {
  it('shortens long addresses and leaves short ones alone', () => {
    expect(shortenAddress('So11111111111111111111111111111111111111112')).toBe(
      'So1111…111112'
    );
    expect(shortenAddress('short')).toBe('short');
    expect(shortenAddress('')).toBe('');
  });
});

describe('accountLabelFromPath', () => {
  it('reads the account index out of a Solana path', () => {
    expect(accountLabelFromPath("m/44'/501'/7'/0'")).toBe('Account 7');
    expect(accountLabelFromPath('nonsense')).toBe('nonsense');
  });
});
