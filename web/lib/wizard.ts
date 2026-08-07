/**
 * Wizard step derivation.
 *
 * The step is never stored. Storing it creates a second source of truth that
 * drifts from the facts it is supposed to describe — the old UI had exactly
 * that bug, where three separate effects raced to open a modal and one of them
 * read the very index it wrote.
 *
 * Instead the step is a pure function of device/account/session state plus two
 * explicit user decisions. Pure and dependency-free so it can be unit tested
 * without React.
 */

export type WizardStep = 'connect' | 'accounts' | 'link' | 'home';

/** An explicit navigation the user asked for, overriding the derived default. */
export type WizardIntent = 'accounts' | 'link' | null;

export interface WizardInputs {
  trezorConnected: boolean;
  accountCount: number;
  /** True once the user has explicitly picked an account. */
  accountChosen: boolean;
  /** Address of the currently selected account, if any. */
  solanaAddress: string | null;
  /** Wallet addresses that currently have at least one live session. */
  linkedAddresses: string[];
  wizardIntent: WizardIntent;
}

export function deriveStep(input: WizardInputs): WizardStep {
  // Nothing is possible without a device and at least one enumerated account.
  // This also handles disconnect from any later step: the facts vanish, so the
  // step falls back on its own rather than needing cleanup logic.
  if (!input.trezorConnected || input.accountCount === 0) return 'connect';

  // An explicit "change account" wins over everything below it.
  if (input.wizardIntent === 'accounts') return 'accounts';

  // First run: an account exists but the user has not chosen one. Choosing is
  // not optional — signing is bound to the approved account, so the user must
  // know which one they picked.
  if (!input.accountChosen) return 'accounts';

  if (input.wizardIntent === 'link') return 'link';

  const linked =
    !!input.solanaAddress && input.linkedAddresses.includes(input.solanaAddress);

  // No dApp linked to this account yet, so linking is the only useful thing to
  // do; Home would be an empty screen.
  return linked ? 'home' : 'link';
}

/** Step order, used for back affordances and progress display. */
export const WIZARD_STEPS: WizardStep[] = [
  'connect',
  'accounts',
  'link',
  'home'
];

export function stepNumber(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step) + 1;
}
