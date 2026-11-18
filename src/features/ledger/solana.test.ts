import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usdCents } from "@/shared";
import { createSolanaLedger } from "./index";
import { loadKeypair } from "./keypair";

vi.mock("./keypair", () => ({ loadKeypair: vi.fn() }));

const devnetGenesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const mainnetGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const devnet = { cluster: "devnet", rpcUrl: "https://rpc.example.test" } as const;
const localnet = { cluster: "localnet", rpcUrl: "http://127.0.0.1:8899" } as const;
const authority = Keypair.generate();
const config = {
  network: devnet,
  mint: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
  recipient: Keypair.generate().publicKey,
  keypairPath: "test-keypair",
};

function fakeRpc(hash: string) {
  const genesis = vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(hash);
  const block = vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({
    blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 123,
  });
  const send = vi.spyOn(Connection.prototype, "sendRawTransaction").mockResolvedValue("signature");
  vi.spyOn(Connection.prototype, "confirmTransaction").mockResolvedValue({ context: { slot: 1 }, value: { err: null } });
  return { genesis, block, send };
}

beforeEach(() => vi.mocked(loadKeypair).mockResolvedValue(authority));
afterEach(() => vi.restoreAllMocks());

it.each([devnet, localnet])("rejects mainnet behind a $cluster endpoint before preparing a transaction", async (network) => {
  const rpc = fakeRpc(mainnetGenesis);
  const ledger = await createSolanaLedger({ ...config, network });
  expect(await ledger.debit("trade", usdCents(200), "trade|SYMBOL|yes|200")).toEqual({
    ok: false, error: { code: "unsafe-ledger-network" },
  });
  expect(rpc.block).not.toHaveBeenCalled();
  expect(rpc.send).not.toHaveBeenCalled();
});

it("requires the devnet genesis hash on devnet", async () => {
  const rpc = fakeRpc(Keypair.generate().publicKey.toBase58());
  const ledger = await createSolanaLedger(config);
  expect(await ledger.debit("trade", usdCents(200), "trade|SYMBOL|yes|200")).toMatchObject({
    ok: false, error: { code: "unsafe-ledger-network" },
  });
  expect(rpc.block).not.toHaveBeenCalled();
});

it("rejects a remote localnet endpoint even when its URL mentions localhost", async () => {
  await expect(createSolanaLedger({ ...config, network: { cluster: "localnet", rpcUrl: "https://localhost@rpc.example.test" } }))
    .rejects.toThrow("Localnet requires a localhost RPC endpoint");
});

it.each([devnet, localnet])("requires explicit approval for a custom mint on $cluster", async (network) => {
  const mint = Keypair.generate().publicKey;
  const rpc = fakeRpc(network.cluster === "devnet" ? devnetGenesis : Keypair.generate().publicKey.toBase58());
  await expect(createSolanaLedger({ ...config, network, mint })).rejects.toThrow("Ledger mint is not approved for testing");
  const ledger = await createSolanaLedger({ ...config, network, mint, testMint: mint });
  expect(await ledger.debit("trade", usdCents(200), "trade|SYMBOL|yes|200")).toMatchObject({ ok: true });
  expect(rpc.genesis).toHaveBeenCalledBefore(rpc.block);
  expect(rpc.send).toHaveBeenCalledOnce();
});

it("accepts Circle devnet USDC and rechecks the network before each debit", async () => {
  const rpc = fakeRpc(devnetGenesis);
  const ledger = await createSolanaLedger(config);
  expect(await ledger.debit("trade", usdCents(200), "trade|SYMBOL|yes|200")).toMatchObject({ ok: true });
  rpc.genesis.mockResolvedValue(mainnetGenesis);
  expect(await ledger.debit("next", usdCents(200), "next|SYMBOL|yes|200")).toMatchObject({
    ok: false, error: { code: "unsafe-ledger-network" },
  });
  expect(rpc.send).toHaveBeenCalledOnce();
});
