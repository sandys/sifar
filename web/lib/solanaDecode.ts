import {
  AddressLookupTableAccount,
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  PublicKey,
  StakeInstruction,
  StakeProgram,
  SystemInstruction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  decodeInstruction,
  isTransferCheckedInstruction,
  isTransferInstruction,
  isApproveInstruction,
  isApproveCheckedInstruction,
  isBurnInstruction,
  isBurnCheckedInstruction,
  isCloseAccountInstruction,
  isSetAuthorityInstruction
} from '@solana/spl-token';

/**
 * Transaction decoding for the signing sheet.
 *
 * Every program is decoded by its own library — `SystemInstruction`,
 * `@solana/spl-token`'s `decodeInstruction`, `ComputeBudgetInstruction`,
 * `StakeInstruction`. No instruction byte layout is parsed here by hand.
 *
 * The guiding rule is that a wrong summary is worse than no summary: anything
 * this file cannot establish from the bytes plus a library decoder is reported
 * as unknown, never guessed.
 */

export type DecodeConfidence = 'full' | 'partial' | 'failed';

export interface DecodedAmount {
  raw: bigint;
  /** Null when we could not establish the mint's decimals. */
  decimals: number | null;
  symbol?: string;
}

export interface DecodedRow {
  kind:
    | 'sol-transfer'
    | 'spl-transfer'
    | 'spl-approve'
    | 'spl-burn'
    | 'spl-close'
    | 'spl-set-authority'
    | 'ata-create'
    | 'compute-budget'
    | 'stake'
    | 'unrecognized';
  programId: string;
  programLabel: string;
  title: string;
  amount?: DecodedAmount;
  from?: string;
  to?: string;
  mint?: string;
  authority?: string;
  /** True when any account for this row was resolved via a lookup table. */
  fromLookupTable: boolean;
  warnings: string[];
}

export interface DecodedTransaction {
  version: 'legacy' | 0;
  feePayer: string | null;
  requiredSigners: string[];
  rows: DecodedRow[];
  confidence: DecodeConfidence;
  /** Lookup tables we could not fetch; non-empty implies `partial`. */
  unresolvedLookupTables: string[];
  notes: string[];
}

export interface DecodeContext {
  lookupTables?: AddressLookupTableAccount[];
  /** mint address -> decimals */
  mintDecimals?: Record<string, number>;
  /** mint address -> symbol, from local data only */
  mintSymbols?: Record<string, string>;
}

const PROGRAM_LABELS: Record<string, string> = {
  [SystemProgram.programId.toBase58()]: 'System Program',
  [TOKEN_PROGRAM_ID.toBase58()]: 'SPL Token',
  [TOKEN_2022_PROGRAM_ID.toBase58()]: 'Token-2022',
  [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()]: 'Associated Token',
  [ComputeBudgetProgram.programId.toBase58()]: 'Compute Budget',
  [StakeProgram.programId.toBase58()]: 'Stake Program'
};

const U64_MAX = 18446744073709551615n;

function unrecognizedRow(
  ix: TransactionInstruction,
  reason: string,
  fromLookupTable: boolean
): DecodedRow {
  const programId = ix.programId.toBase58();
  return {
    kind: 'unrecognized',
    programId,
    programLabel: PROGRAM_LABELS[programId] || 'Unrecognized program',
    title: PROGRAM_LABELS[programId]
      ? `${PROGRAM_LABELS[programId]} — unreadable instruction`
      : 'Unrecognized program',
    fromLookupTable,
    warnings: [
      `${reason} ${ix.keys.length} accounts, ${ix.data.length} bytes of data. Verify this on your Trezor before confirming.`
    ]
  };
}

function decodeSystem(
  ix: TransactionInstruction,
  fromLookupTable: boolean
): DecodedRow {
  const type = SystemInstruction.decodeInstructionType(ix);
  const base = {
    programId: ix.programId.toBase58(),
    programLabel: 'System Program',
    fromLookupTable,
    warnings: [] as string[]
  };

  if (type === 'Transfer') {
    const decoded = SystemInstruction.decodeTransfer(ix);
    return {
      ...base,
      kind: 'sol-transfer',
      title: 'Transfer SOL',
      from: decoded.fromPubkey.toBase58(),
      to: decoded.toPubkey.toBase58(),
      amount: { raw: BigInt(decoded.lamports.toString()), decimals: 9, symbol: 'SOL' }
    };
  }

  if (type === 'TransferWithSeed') {
    const decoded = SystemInstruction.decodeTransferWithSeed(ix);
    return {
      ...base,
      kind: 'sol-transfer',
      title: 'Transfer SOL (derived account)',
      from: decoded.fromPubkey.toBase58(),
      to: decoded.toPubkey.toBase58(),
      amount: { raw: BigInt(decoded.lamports.toString()), decimals: 9, symbol: 'SOL' }
    };
  }

  return { ...base, kind: 'unrecognized', title: `System: ${type}` };
}

function decodeToken(
  ix: TransactionInstruction,
  ctx: DecodeContext,
  fromLookupTable: boolean
): DecodedRow {
  const programId = ix.programId.toBase58();
  const base = {
    programId,
    programLabel: PROGRAM_LABELS[programId] || 'SPL Token',
    fromLookupTable,
    warnings: [] as string[]
  };

  const decoded = decodeInstruction(ix, ix.programId);

  const lookupAmount = (mint: string | undefined, raw: bigint): DecodedAmount => {
    const decimals = mint ? ctx.mintDecimals?.[mint] : undefined;
    return {
      raw,
      decimals: typeof decimals === 'number' ? decimals : null,
      symbol: mint ? ctx.mintSymbols?.[mint] : undefined
    };
  };

  // Checked variants carry decimals in the instruction data itself — exact and
  // free, no network round-trip and no guessing.
  if (isTransferCheckedInstruction(decoded)) {
    const mint = decoded.keys.mint.pubkey.toBase58();
    return {
      ...base,
      kind: 'spl-transfer',
      title: 'Transfer tokens',
      mint,
      from: decoded.keys.source.pubkey.toBase58(),
      to: decoded.keys.destination.pubkey.toBase58(),
      authority: decoded.keys.owner.pubkey.toBase58(),
      amount: {
        raw: decoded.data.amount,
        decimals: decoded.data.decimals,
        symbol: ctx.mintSymbols?.[mint]
      }
    };
  }

  if (isTransferInstruction(decoded)) {
    // Unchecked transfer does not even name the mint, so decimals can only come
    // from context. Without them the amount is shown as base units.
    return {
      ...base,
      kind: 'spl-transfer',
      title: 'Transfer tokens',
      from: decoded.keys.source.pubkey.toBase58(),
      to: decoded.keys.destination.pubkey.toBase58(),
      authority: decoded.keys.owner.pubkey.toBase58(),
      amount: lookupAmount(undefined, decoded.data.amount),
      warnings: ['This instruction does not name the token. Confirm the mint on your Trezor.']
    };
  }

  if (isApproveCheckedInstruction(decoded) || isApproveInstruction(decoded)) {
    const checked = isApproveCheckedInstruction(decoded);
    const mint = checked
      ? (decoded as any).keys.mint.pubkey.toBase58()
      : undefined;
    const raw = decoded.data.amount as bigint;
    return {
      ...base,
      kind: 'spl-approve',
      title: 'Approve a delegate',
      mint,
      from: decoded.keys.account.pubkey.toBase58(),
      to: decoded.keys.delegate.pubkey.toBase58(),
      amount: checked
        ? { raw, decimals: (decoded as any).data.decimals, symbol: mint ? ctx.mintSymbols?.[mint] : undefined }
        : lookupAmount(mint, raw),
      warnings: [
        raw >= U64_MAX
          ? 'Grants an UNLIMITED allowance — the delegate could move all of these tokens later.'
          : 'Grants a delegate permission to move your tokens later.'
      ]
    };
  }

  if (isBurnCheckedInstruction(decoded) || isBurnInstruction(decoded)) {
    const mint = decoded.keys.mint.pubkey.toBase58();
    const checked = isBurnCheckedInstruction(decoded);
    return {
      ...base,
      kind: 'spl-burn',
      title: 'Burn tokens',
      mint,
      from: decoded.keys.account.pubkey.toBase58(),
      amount: checked
        ? { raw: decoded.data.amount, decimals: (decoded as any).data.decimals, symbol: ctx.mintSymbols?.[mint] }
        : lookupAmount(mint, decoded.data.amount),
      warnings: ['Burning destroys these tokens permanently.']
    };
  }

  if (isCloseAccountInstruction(decoded)) {
    return {
      ...base,
      kind: 'spl-close',
      title: 'Close token account',
      from: decoded.keys.account.pubkey.toBase58(),
      to: decoded.keys.destination.pubkey.toBase58(),
      warnings: ['Closes the account and sends its remaining rent elsewhere.']
    };
  }

  if (isSetAuthorityInstruction(decoded)) {
    return {
      ...base,
      kind: 'spl-set-authority',
      title: 'Change account authority',
      from: decoded.keys.account.pubkey.toBase58(),
      warnings: ['Changes who controls this account or mint.']
    };
  }

  return { ...base, kind: 'unrecognized', title: 'SPL Token instruction' };
}

function decodeOne(
  ix: TransactionInstruction,
  ctx: DecodeContext,
  fromLookupTable: boolean
): DecodedRow {
  const programId = ix.programId.toBase58();

  // Every decoder call is individually guarded. spl-token throws on Token-2022
  // extension instructions and unknown discriminants; one unreadable
  // instruction must degrade its own row, never the whole summary.
  try {
    if (programId === SystemProgram.programId.toBase58()) {
      return decodeSystem(ix, fromLookupTable);
    }
    if (
      programId === TOKEN_PROGRAM_ID.toBase58() ||
      programId === TOKEN_2022_PROGRAM_ID.toBase58()
    ) {
      return decodeToken(ix, ctx, fromLookupTable);
    }
    if (programId === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
      return {
        kind: 'ata-create',
        programId,
        programLabel: 'Associated Token',
        title: 'Create associated token account',
        fromLookupTable,
        warnings: []
      };
    }
    if (programId === ComputeBudgetProgram.programId.toBase58()) {
      const type = ComputeBudgetInstruction.decodeInstructionType(ix);
      return {
        kind: 'compute-budget',
        programId,
        programLabel: 'Compute Budget',
        title: `Fee setting: ${type}`,
        fromLookupTable,
        warnings: []
      };
    }
    if (programId === StakeProgram.programId.toBase58()) {
      const type = StakeInstruction.decodeInstructionType(ix);
      return {
        kind: 'stake',
        programId,
        programLabel: 'Stake Program',
        title: `Stake: ${type}`,
        fromLookupTable,
        warnings: []
      };
    }
  } catch (err: any) {
    return unrecognizedRow(
      ix,
      `Sifar could not read this instruction (${err?.message || 'decode failed'}).`,
      fromLookupTable
    );
  }

  return unrecognizedRow(ix, 'Sifar does not recognise this program.', fromLookupTable);
}

/**
 * Decode without touching the network.
 *
 * Safe to call immediately on render; pass a context later to upgrade the
 * result from `partial` to `full`.
 */
export function decodeTransactionSync(
  raw: Uint8Array,
  ctx: DecodeContext = {}
): DecodedTransaction {
  const notes: string[] = [];

  // Legacy first: it has only static keys, so it always decodes fully.
  let versioned: VersionedTransaction | null = null;
  try {
    versioned = VersionedTransaction.deserialize(raw);
  } catch {
    versioned = null;
  }

  if (!versioned) {
    try {
      const tx = Transaction.from(raw);
      const rows = tx.instructions.map((ix) => decodeOne(ix, ctx, false));
      return {
        version: 'legacy',
        feePayer: tx.feePayer?.toBase58() ?? null,
        requiredSigners: tx.signatures.map((s) => s.publicKey.toBase58()),
        rows,
        confidence: 'full',
        unresolvedLookupTables: [],
        notes
      };
    } catch (err: any) {
      return {
        version: 'legacy',
        feePayer: null,
        requiredSigners: [],
        rows: [],
        confidence: 'failed',
        unresolvedLookupTables: [],
        notes: [
          'Could not decode this transaction. Verify it entirely on your Trezor.'
        ]
      };
    }
  }

  const message = versioned.message;
  const isV0 = message.version === 0;
  const lookups = isV0 ? (message as any).addressTableLookups ?? [] : [];
  const staticKeys = message.staticAccountKeys;
  const signerCount = message.header.numRequiredSignatures;
  const requiredSigners = staticKeys
    .slice(0, signerCount)
    .map((k) => k.toBase58());
  const feePayer = staticKeys[0]?.toBase58() ?? null;

  if (lookups.length === 0) {
    const decompiled = TransactionMessage.decompile(message);
    return {
      version: isV0 ? 0 : 'legacy',
      feePayer,
      requiredSigners,
      rows: decompiled.instructions.map((ix) => decodeOne(ix, ctx, false)),
      confidence: 'full',
      unresolvedLookupTables: [],
      notes
    };
  }

  const supplied = ctx.lookupTables ?? [];
  const suppliedKeys = new Set(supplied.map((t) => t.key.toBase58()));
  const missing = lookups
    .map((l: any) => l.accountKey.toBase58())
    .filter((key: string) => !suppliedKeys.has(key));

  if (missing.length === 0) {
    try {
      const decompiled = TransactionMessage.decompile(message, {
        addressLookupTableAccounts: supplied
      });
      return {
        version: 0,
        feePayer,
        requiredSigners,
        rows: decompiled.instructions.map((ix) =>
          decodeOne(ix, ctx, true)
        ),
        confidence: 'full',
        unresolvedLookupTables: [],
        notes: [
          'Some accounts in this transaction came from an address lookup table.'
        ]
      };
    } catch (err: any) {
      notes.push(
        'Address lookup tables could not be applied to this transaction.'
      );
    }
  }

  // Unresolved lookups. Instructions whose account indexes all fall inside the
  // static key list are still decodable — static keys always occupy the low
  // indexes. Anything reaching into a lookup table is reported as unknown with
  // no addresses populated, because the alternative is rendering a wrong
  // recipient as fact.
  const rows: DecodedRow[] = (message as any).compiledInstructions.map(
    (compiled: any) => {
      const programKey = staticKeys[compiled.programIdIndex];
      const indexes: number[] = Array.from(compiled.accountKeyIndexes ?? []);
      const usesLookup =
        !programKey || indexes.some((i) => i >= staticKeys.length);

      if (usesLookup) {
        return {
          kind: 'unrecognized' as const,
          programId: programKey ? programKey.toBase58() : 'unknown',
          programLabel: programKey
            ? PROGRAM_LABELS[programKey.toBase58()] || 'Unrecognized program'
            : 'Unknown program',
          title: 'Instruction using an address lookup table',
          fromLookupTable: true,
          warnings: [
            'Sifar could not fetch the address lookup table for this instruction, so its accounts are unknown. Verify every line on your Trezor.'
          ]
        };
      }

      const ix = new TransactionInstruction({
        programId: programKey,
        keys: indexes.map((i) => ({
          pubkey: staticKeys[i],
          isSigner: i < signerCount,
          isWritable: message.isAccountWritable(i)
        })),
        data: Buffer.from(compiled.data)
      });
      return decodeOne(ix, ctx, false);
    }
  );

  return {
    version: 0,
    feePayer,
    requiredSigners,
    rows,
    confidence: 'partial',
    unresolvedLookupTables: missing,
    notes: [
      'Part of this transaction could not be decoded because an address lookup table was unavailable.'
    ]
  };
}
