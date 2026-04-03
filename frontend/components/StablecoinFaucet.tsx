"use client";

import { isAddress } from "ethers";
import { useEffect, useState } from "react";
import { ADDRESSES, getContracts, getSigner } from "../lib/contracts";
import { normalizeError } from "../lib/errors";
import { formatUsdMicro, parseUsdToMicro } from "../lib/format";
import { encryptAmount, getOrCreateFhevmInstance, reencryptBalance } from "../lib/fhevm";
import { getExplorerTransactionUrl } from "../lib/protocol-config";

interface StablecoinFaucetProps {
  walletAddress?: string;
  balance?: bigint | null;
  onMinted?: () => Promise<void> | void;
}

export default function StablecoinFaucet({
  walletAddress,
  balance,
  onMinted,
}: StablecoinFaucetProps) {
  const [amount, setAmount] = useState("1000");
  const [recipient, setRecipient] = useState("");
  const [walletBalance, setWalletBalance] = useState<bigint | null>(balance ?? null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWalletBalance(balance ?? null);
  }, [balance]);

  useEffect(() => {
    if (typeof balance === "undefined") {
      refreshBalance().catch(() => undefined);
    }
  }, [balance]);

  async function refreshBalance() {
    setIsRefreshingBalance(true);
    setError(null);

    try {
      const { signer } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance();
      const activeWalletAddress = walletAddress ?? await signer.getAddress();
      const balanceHandle = await contracts.stablecoin.balanceOf(activeWalletAddress);
      const nextBalance = await reencryptBalance(inst, signer, ADDRESSES.stablecoin, balanceHandle);
      setWalletBalance(nextBalance);
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setIsRefreshingBalance(false);
    }
  }

  async function handleMint(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setTxHash(null);

    try {
      const { signer, address } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance();
      const activeWalletAddress = walletAddress ?? address;
      const destination = recipient.trim() || activeWalletAddress;

      if (!isAddress(destination)) {
        throw new Error("Enter a valid recipient address.");
      }

      const mintAmount = parseUsdToMicro(amount);

      const { handle, inputProof } = await encryptAmount(
        inst,
        ADDRESSES.stablecoin,
        ADDRESSES.stablecoinFaucet,
        mintAmount,
      );

      const tx =
        destination.toLowerCase() === activeWalletAddress.toLowerCase()
          ? await contracts.stablecoinFaucet.mintToSelf(handle, inputProof)
          : await contracts.stablecoinFaucet.mint(destination, handle, inputProof);

      await tx.wait();
      setTxHash(tx.hash);

      if (typeof balance === "undefined") {
        await refreshBalance();
      }

      await onMinted?.();
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full max-w-2xl rounded-xl border border-gray-800 bg-gray-900 p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Testnet Faucet</h2>
          <p className="mt-1 text-sm text-gray-400">
            Mint encrypted sUSD on Sepolia so you can repay loans and test the dashboard flow end to
            end.
          </p>
        </div>
        <button
          onClick={() => refreshBalance().catch(() => undefined)}
          className="rounded border border-gray-700 px-3 py-2 text-xs text-gray-300 transition-colors hover:border-indigo-500 hover:text-white"
        >
          {isRefreshingBalance ? "Refreshing..." : "Refresh Balance"}
        </button>
      </div>

      <div className="mb-6 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Wallet Balance</p>
        <p className="mt-2 text-3xl font-bold text-white">
          {walletBalance === null ? "Loading..." : `${formatUsdMicro(walletBalance)} sUSD`}
        </p>
        <p className="mt-1 text-sm text-gray-400">This view decrypts only your own confidential balance.</p>
      </div>

      <form onSubmit={handleMint} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Amount (sUSD)</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="Leave blank to mint to the connected wallet"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            The amount stays encrypted on-chain. On Sepolia, powered by Zama
          </p>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 py-2.5 font-semibold text-white shadow-lg transition-all duration-200 hover:from-cyan-600 hover:to-emerald-600 disabled:opacity-50"
        >
          {isLoading ? "Minting Encrypted sUSD..." : "Mint Test Balance"}
        </button>
      </form>

      {txHash && (
        <div className="mt-4 rounded-lg border border-green-700 bg-green-900/30 p-4">
          <p className="font-medium text-green-300">✅ Faucet mint confirmed</p>
          <a
            href={getExplorerTransactionUrl(txHash)}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block break-all font-mono text-xs text-green-400 hover:text-green-300"
          >
            {txHash}
          </a>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-700 bg-red-900/30 p-4">
          <p className="text-sm text-red-300">❌ {error}</p>
        </div>
      )}
    </div>
  );
}
