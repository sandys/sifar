import { describe, it, expect } from 'vitest';
import { deriveStep, stepNumber, type WizardInputs } from './wizard';

const base: WizardInputs = {
  trezorConnected: true,
  accountCount: 3,
  accountChosen: true,
  solanaAddress: 'AAA',
  linkedAddresses: [],
  wizardIntent: null
};

describe('deriveStep', () => {
  it('starts at connect with no device', () => {
    expect(deriveStep({ ...base, trezorConnected: false })).toBe('connect');
  });

  it('stays at connect while enumeration has produced nothing', () => {
    expect(deriveStep({ ...base, accountCount: 0 })).toBe('connect');
  });

  it('requires an explicit account choice before linking', () => {
    expect(deriveStep({ ...base, accountChosen: false })).toBe('accounts');
  });

  it('goes to link once an account is chosen but nothing is connected', () => {
    expect(deriveStep(base)).toBe('link');
  });

  it('goes home once this account has a session', () => {
    expect(deriveStep({ ...base, linkedAddresses: ['AAA'] })).toBe('home');
  });

  it('does not count another account\'s session as linked', () => {
    expect(deriveStep({ ...base, linkedAddresses: ['BBB'] })).toBe('link');
  });

  it('honours an explicit change-account intent from home', () => {
    expect(
      deriveStep({
        ...base,
        linkedAddresses: ['AAA'],
        wizardIntent: 'accounts'
      })
    ).toBe('accounts');
  });

  it('honours an explicit link-another-dApp intent from home', () => {
    expect(
      deriveStep({ ...base, linkedAddresses: ['AAA'], wizardIntent: 'link' })
    ).toBe('link');
  });

  it('falls back to connect even with an intent set, when the device is gone', () => {
    // Disconnecting mid-wizard must not strand the user on a dead step.
    expect(
      deriveStep({
        ...base,
        trezorConnected: false,
        wizardIntent: 'link'
      })
    ).toBe('connect');
  });

  it('is a pure function of its inputs', () => {
    const input = { ...base, linkedAddresses: ['AAA'] };
    expect(deriveStep(input)).toBe(deriveStep(input));
  });
});

describe('stepNumber', () => {
  it('numbers steps from one', () => {
    expect(stepNumber('connect')).toBe(1);
    expect(stepNumber('home')).toBe(4);
  });
});
