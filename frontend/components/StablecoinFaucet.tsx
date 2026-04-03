"use client";

import { isAddress } from "ethers";
import { useState } from "react";
import { ADDRESSES, getContracts, getSigner } from "../lib/contracts";
import { normalizeError } from "../lib/errors";
import { formatUsdMicro, parseUsdToMicro } from "../lib/format";
import { encryptAmount, getOrCreateFhevmInstance } from "../lib/fhevm";
import { getExplorerTransactionUrl } from "../lib/protocol-config";

interface StablecoinFaucetProps {
  walletAddress: string;
  balance: bigint | null;
  onMinted?: () => Promise<void> | void;
}

export default function StablecoinFaucet({
  walletAddress,
  balance,
  onMinted,
}: StablecoinFaucetProps) {
  const [amount, setAmount] = useState("250");
  const [recipient, setRecipient] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMint(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setTxHash(null);

    try {
      const { signer } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance();
      const destination = recipient.trim() || walletAddress;

      if (!isAddress(destination)) {
        throw new Error("Enter a valid recipient address.");
      }

      const mintAmount = parseUsdToMicro(amount);

      // The stablecoin verifies encrypted inputs, so the ciphertext must target the
      // stablecoin contract while using the faucet as the submitting account context.
      const { handle, inputProof } = await encryptAmount(
        inst,
        ADDRESSES.stablecoin,
        ADDRESSES.stablecoinFaucet,
        mintAmount,
      );

      const tx =
        destination.toLowerCase() === walletAddress.toLowerCase()
          ? await contracts.stablecoinFaucet.mintToSelf(handle, inputProof)
          : await contracts.stablecoinFaucet.mint(destination, handle, inputProof);

      await tx.wait();
      setTxHash(tx.hash);
      await onMinted?.();
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">Faucet</h3>
          <p className="mt-1 text-sm text-slate-400">
            Mint live encrypted sUSD from the deployed Sepolia faucet when you need balance for
            repayments or transfers.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Current balance</p>
          <p className="mt-2 text-xl font-semibold text-white">{formatUsdMicro(balance)} sUSD</p>
        </div>
      </div>

      <form onSubmit={handleMint} className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Amount"
          required
          className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
        />
        <input
          type="text"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          placeholder="Recipient address (leave blank for self)"
          className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
        >
          {isLoading ? "Minting..." : "Mint sUSD"}
        </button>
      </form>

      {txHash && (
        <a
          href={getExplorerTransactionUrl(txHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-4 block text-sm text-cyan-300 transition hover:text-cyan-200"
        >
          Mint confirmed · view transaction
        </a>
      )}

      {error && <p className="mt-4 text-sm text-rose-200">{error}</p>}
    </div>
  );
}
