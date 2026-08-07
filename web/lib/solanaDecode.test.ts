import { describe, it, expect } from 'vitest';
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  createApproveInstruction
} from '@solana/spl-token';
import bs58 from 'bs58';
import { decodeTransactionSync } from './solanaDecode';

const BLOCKHASH = bs58.encode(new Uint8Array(32).fill(3));
const payer = Keypair.generate().publicKey;

function v0(instructions: TransactionInstruction[]) {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: BLOCKHASH,
    instructions
  }).compileToV0Message();
  return new VersionedTransaction(message).serialize();
}

describe('decodeTransactionSync — System', () => {
  it('decodes a SOL transfer with exact lamports', () => {
    const to = Keypair.generate().publicKey;
    const raw = v0([
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: to, lamports: 1_500_000_000 })
    ]);

    const decoded = decodeTransactionSync(raw);
    expect(decoded.confidence).toBe('full');
    expect(decoded.rows).toHaveLength(1);

    const row = decoded.rows[0];
    expect(row.kind).toBe('sol-transfer');
    expect(row.from).toBe(payer.toBase58());
    expect(row.to).toBe(to.toBase58());
    expect(row.amount?.raw).toBe(1_500_000_000n);
    expect(row.amount?.decimals).toBe(9);
  });
});

describe('decodeTransactionSync — SPL Token', () => {
  it('takes decimals from a checked transfer without any context', () => {
    const source = Keypair.generate().publicKey;
    const dest = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;

    const raw = v0([
      createTransferCheckedInstruction(source, mint, dest, payer, 250_000n, 6)
    ]);

    const decoded = decodeTransactionSync(raw);
    const row = decoded.rows[0];
    expect(row.kind).toBe('spl-transfer');
    expect(row.mint).toBe(mint.toBase58());
    expect(row.amount?.raw).toBe(250_000n);
    // Carried in the instruction data, so exact and free.
    expect(row.amount?.decimals).toBe(6);
  });

  it('reports unknown decimals rather than guessing on an unchecked transfer', () => {
    const source = Keypair.generate().publicKey;
    const delegate = Keypair.generate().publicKey;
    const raw = v0([
      createApproveInstruction(source, delegate, payer, 42n, [], TOKEN_PROGRAM_ID)
    ]);

    const decoded = decodeTransactionSync(raw);
    const row = decoded.rows[0];
    expect(row.kind).toBe('spl-approve');
    expect(row.amount?.raw).toBe(42n);
    expect(row.amount?.decimals).toBeNull();
  });

  it('flags an unlimited approval', () => {
    const source = Keypair.generate().publicKey;
    const delegate = Keypair.generate().publicKey;
    const max = 18446744073709551615n;
    const raw = v0([
      createApproveInstruction(source, delegate, payer, max, [], TOKEN_PROGRAM_ID)
    ]);

    const decoded = decodeTransactionSync(raw);
    expect(decoded.rows[0].warnings.join(' ')).toMatch(/UNLIMITED/i);
  });
});

describe('decodeTransactionSync — unknown programs', () => {
  it('never guesses at an unrecognised program', () => {
    const unknownProgram = Keypair.generate().publicKey;
    const raw = v0([
      new TransactionInstruction({
        programId: unknownProgram,
        keys: [{ pubkey: payer, isSigner: true, isWritable: true }],
        data: Buffer.from([1, 2, 3, 4])
      })
    ]);

    const decoded = decodeTransactionSync(raw);
    const row = decoded.rows[0];
    expect(row.kind).toBe('unrecognized');
    expect(row.programId).toBe(unknownProgram.toBase58());
    expect(row.from).toBeUndefined();
    expect(row.to).toBeUndefined();
    expect(row.warnings.join(' ')).toMatch(/verify this on your trezor/i);
  });
});

describe('decodeTransactionSync — address lookup tables', () => {
  // The highest-consequence case: with an unresolved lookup table, the account
  // list is incomplete. Falling back to staticAccountKeys[i] would render a
  // WRONG recipient as fact, which is strictly worse than showing nothing.
  const tableKey = Keypair.generate().publicKey;
  const looked = [
    Keypair.generate().publicKey,
    Keypair.generate().publicKey
  ];

  const table = new AddressLookupTableAccount({
    key: tableKey,
    state: {
      deactivationSlot: BigInt('18446744073709551615'),
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: payer,
      addresses: looked
    }
  });

  function v0WithLookup() {
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: BLOCKHASH,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: looked[0],
          lamports: 5
        })
      ]
    }).compileToV0Message([table]);
    return new VersionedTransaction(message).serialize();
  }

  it('reports partial confidence and leaves addresses undefined when the table is missing', () => {
    const decoded = decodeTransactionSync(v0WithLookup());

    expect(decoded.confidence).toBe('partial');
    expect(decoded.unresolvedLookupTables).toContain(tableKey.toBase58());

    const lookupRows = decoded.rows.filter((r) => r.fromLookupTable);
    expect(lookupRows.length).toBeGreaterThan(0);
    for (const row of lookupRows) {
      expect(row.kind).toBe('unrecognized');
      // The whole point: no address is invented from the static key list.
      expect(row.from).toBeUndefined();
      expect(row.to).toBeUndefined();
      expect(row.mint).toBeUndefined();
    }
  });

  it('decodes fully once the table is supplied', () => {
    const decoded = decodeTransactionSync(v0WithLookup(), {
      lookupTables: [table]
    });

    expect(decoded.confidence).toBe('full');
    expect(decoded.unresolvedLookupTables).toHaveLength(0);
    const row = decoded.rows[0];
    expect(row.kind).toBe('sol-transfer');
    expect(row.to).toBe(looked[0].toBase58());
    expect(row.amount?.raw).toBe(5n);
  });
});
