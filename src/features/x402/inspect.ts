import { TOKEN_PROGRAM_ID, TokenInstruction, decodeTransferCheckedInstruction } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import type { TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { USDC_DECIMALS } from "./schema";
import type { PaymentErrorCode } from "./schema";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const MAX_TRANSACTION_BYTES = 1232;

export interface PaymentExpectation {
  readonly mint: PublicKey;
  readonly destination: PublicKey;
  readonly amount: bigint;
}

export interface InspectedPayment {
  readonly payer: string;
  readonly signature: string;
  readonly memo: string;
  readonly blockhash: string;
  readonly rawTransaction: Buffer;
}

export type InspectResult =
  | { readonly ok: true; readonly value: InspectedPayment }
  | { readonly ok: false; readonly error: PaymentErrorCode };

const fail = (error: PaymentErrorCode): InspectResult => ({ ok: false, error });

function decodeTransaction(base64: string): { readonly raw: Buffer; readonly transaction: Transaction } | undefined {
  const raw = Buffer.from(base64, "base64");
  if (raw.length === 0 || raw.length > MAX_TRANSACTION_BYTES) return undefined;
  try {
    return { raw, transaction: Transaction.from(raw) };
  } catch {
    return undefined;
  }
}

function isTransferChecked(instruction: TransactionInstruction): boolean {
  return instruction.programId.equals(TOKEN_PROGRAM_ID) && instruction.data[0] === TokenInstruction.TransferChecked;
}

function classify(instructions: readonly TransactionInstruction[]) {
  const transfers = instructions.filter(isTransferChecked);
  const memos = instructions.filter((instruction) => instruction.programId.equals(MEMO_PROGRAM_ID));
  const others = instructions.filter(
    (instruction) => !isTransferChecked(instruction)
      && !instruction.programId.equals(MEMO_PROGRAM_ID)
      && !instruction.programId.equals(ComputeBudgetProgram.programId),
  );
  return { transfers, memos, others };
}

export function inspectPayment(transactionBase64: string, expected: PaymentExpectation): InspectResult {
  const decoded = decodeTransaction(transactionBase64);
  if (!decoded) return fail("invalid_transaction");
  const { raw, transaction } = decoded;
  const { transfers, memos, others } = classify(transaction.instructions);
  const [transfer] = transfers;
  const [memoInstruction] = memos;
  if (others.length > 0 || transfers.length > 1 || memos.length > 1) return fail("unexpected_instruction");
  if (!transfer) return fail("missing_transfer");
  let decodedTransfer;
  try {
    decodedTransfer = decodeTransferCheckedInstruction(transfer, TOKEN_PROGRAM_ID);
  } catch {
    return fail("invalid_transaction");
  }
  const { keys, data } = decodedTransfer;
  if (keys.multiSigners.length > 0) return fail("unexpected_instruction");
  if (!keys.mint.pubkey.equals(expected.mint)) return fail("wrong_mint");
  if (!keys.destination.pubkey.equals(expected.destination)) return fail("wrong_recipient");
  if (data.decimals !== USDC_DECIMALS) return fail("wrong_decimals");
  if (data.amount !== expected.amount) return fail("wrong_amount");
  if (!memoInstruction || memoInstruction.keys.length > 0) return fail("memo_mismatch");
  const { feePayer, signature } = transaction;
  if (!transaction.recentBlockhash) return fail("invalid_transaction");
  if (!feePayer || !signature || !keys.owner.pubkey.equals(feePayer)) return fail("wrong_payer");
  if (!transaction.verifySignatures()) return fail("invalid_signature");
  return {
    ok: true,
    value: {
      payer: feePayer.toBase58(),
      signature: bs58.encode(signature),
      memo: memoInstruction.data.toString("utf8"),
      blockhash: transaction.recentBlockhash,
      rawTransaction: raw,
    },
  };
}
