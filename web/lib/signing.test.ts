import { describe, it, expect, beforeEach } from 'vitest';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction
} from '@solana/web3.js';
import bs58 from 'bs58';
import { resolveTransactionSigner } from './signing';
import { useAppStore } from './store';

const BLOCKHASH = bs58.encode(new Uint8Array(32).fill(7));

const walletA = Keypair.generate().publicKey;
const walletB = Keypair.generate().publicKey;
const stranger = Keypair.generate().publicKey;

function account(address: PublicKey, index: number) {
  return {
    address: address.toBase58(),
    path: `m/44'/501'/${index}'/0'`,
    balance: null,
    tokens: [],
    balanceStatus: 'loading' as const,
    balanceError: null
  };
}

/** Build a transaction paid for by `payer`, optionally requiring a co-signer. */
function buildTx(payer: PublicKey, coSigner?: PublicKey) {
  const source = coSigner ?? payer;
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: BLOCKHASH,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: source,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1
      })
    ]
  }).compileToV0Message();
  return new VersionedTransaction(message).serialize();
}

describe('resolveTransactionSigner', () => {
  beforeEach(() => {
    useAppStore
      .getState()
      .setSolanaAccounts([account(walletA, 0), account(walletB, 1)]);
  });

  it('resolves the fee payer when it is the session account', () => {
    const { account: resolved, signerKey } = resolveTransactionSigner(
      buildTx(walletA),
      walletA.toBase58()
    );
    expect(resolved.path).toBe("m/44'/501'/0'/0'");
    expect(signerKey.toBase58()).toBe(walletA.toBase58());
  });

  it('resolves a required co-signer that is not the fee payer', () => {
    // Fee paid by a stranger (sponsored fee / multisig): the wallet still signs,
    // just not from account-key index 0.
    const raw = buildTx(stranger, walletB);
    const keys = VersionedTransaction.deserialize(raw).message.staticAccountKeys;
    expect(keys[0].toBase58()).toBe(stranger.toBase58());

    const { account: resolved, signerKey } = resolveTransactionSigner(
      raw,
      walletB.toBase58()
    );
    expect(resolved.path).toBe("m/44'/501'/1'/0'");
    expect(signerKey.toBase58()).toBe(walletB.toBase58());
  });

  it('refuses a transaction the connected account is not asked to sign', () => {
    // A dApp approved for walletA must not obtain a walletB signature, even
    // though walletB is enumerated on the same device.
    expect(() =>
      resolveTransactionSigner(buildTx(walletB), walletA.toBase58())
    ).toThrow(/does not require a signature from the connected account/i);
  });

  it('refuses when the session account is not on the device', () => {
    expect(() =>
      resolveTransactionSigner(buildTx(stranger), stranger.toBase58())
    ).toThrow(/No Trezor account found for signer/i);
  });
});
