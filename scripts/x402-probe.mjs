import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

const [baseArg, symbol, mode] = process.argv.slice(2);
if (!baseArg || !symbol || !["replay", "wrong-amount"].includes(mode ?? "")) {
  console.error("usage: node --env-file=.env.local scripts/x402-probe.mjs <baseUrl> <symbol> <replay|wrong-amount>");
  process.exit(1);
}
const endpoint = `${baseArg.replace(/\/+$/u, "")}/api/research/${encodeURIComponent(symbol)}/deep`;
const memoProgram = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const keypairPath = process.env.SOLANA_KEYPAIR_PATH.startsWith("~/") ? join(homedir(), process.env.SOLANA_KEYPAIR_PATH.slice(2)) : process.env.SOLANA_KEYPAIR_PATH;
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(keypairPath, "utf8"))));
const connection = new Connection(process.env.SOLANA_RPC_URL, "confirmed");

async function requirements() {
  const response = await fetch(endpoint);
  const body = await response.json();
  return { status: response.status, requirement: body.accepts[0] };
}

async function buildHeader(requirement, amountDelta) {
  const mint = new PublicKey(requirement.asset);
  const block = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: payer.publicKey, blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight }).add(
    createTransferCheckedInstruction(
      getAssociatedTokenAddressSync(mint, payer.publicKey),
      mint,
      getAssociatedTokenAddressSync(mint, new PublicKey(requirement.payTo)),
      payer.publicKey,
      BigInt(requirement.maxAmountRequired) + amountDelta,
      6,
    ),
    new TransactionInstruction({ programId: memoProgram, keys: [], data: Buffer.from(requirement.extra.memo) }),
  );
  transaction.sign(payer);
  const payload = { x402Version: 1, scheme: "exact", network: requirement.network, payload: { transaction: transaction.serialize().toString("base64") } };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function submit(label, header) {
  const response = await fetch(endpoint, { headers: { "X-PAYMENT": header } });
  const body = await response.json();
  const receipt = response.headers.get("X-PAYMENT-RESPONSE");
  console.log(`${label}: HTTP ${String(response.status)} error=${body.error ?? "none"} headline=${body.headline ?? "none"}`);
  if (receipt) console.log(`${label}: X-PAYMENT-RESPONSE ${Buffer.from(receipt, "base64").toString("utf8")}`);
}

if (mode === "replay") {
  const { requirement } = await requirements();
  const header = await buildHeader(requirement, 0n);
  await submit("valid payment", header);
  await submit("replay of the same X-PAYMENT header", header);
}

if (mode === "wrong-amount") {
  for (const [label, delta] of [["underpayment (-1 base unit)", -1n], ["overpayment (+1 base unit)", 1n]]) {
    const { requirement } = await requirements();
    await submit(label, await buildHeader(requirement, delta));
  }
}
