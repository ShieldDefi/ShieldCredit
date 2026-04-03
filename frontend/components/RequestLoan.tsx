"use client";

import { useState } from "react";
import { getContracts, getSigner } from "../lib/contracts";
import { normalizeError } from "../lib/errors";
import { parseUsdToMicro } from "../lib/format";
import { encryptAmount, getOrCreateFhevmInstance } from "../lib/fhevm";

interface RequestLoanProps {
  onSuccess?: () => void;
}

export default function RequestLoan({ onSuccess }: RequestLoanProps) {
  const [assetId, setAssetId] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [createdLoanId, setCreatedLoanId] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setCreatedLoanId(null);

    try {
      const assetIdValue = assetId.trim();
      if (!assetIdValue) {
        throw new Error("Enter the asset ID you want to borrow against.");
      }

      const { signer, address } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance();
      const loanAmountMicro = parseUsdToMicro(loanAmount);
      const lendingAddress = await contracts.privateLending.getAddress();
      const { handle, inputProof } = await encryptAmount(inst, lendingAddress, address, loanAmountMicro);

      const tx = await contracts.privateLending.requestLoan(BigInt(assetIdValue), handle, inputProof);
      const receipt = await tx.wait();
      const eventLog = receipt?.logs.find(
        (log: { fragment?: { name?: string } }) => log.fragment?.name === "LoanCreated",
      );

      setCreatedLoanId((eventLog as { args?: [bigint] })?.args?.[0] ?? null);
      onSuccess?.();
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
      <h3 className="text-lg font-semibold text-white">Open a loan</h3>
      <p className="mt-2 text-sm text-slate-400">
        Borrow encrypted sUSD against an already registered asset. Live lending limits and loan
        checks are enforced by the deployed contracts.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label className="mb-2 block text-sm text-slate-300">Asset ID</label>
          <input
            type="number"
            min="0"
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
            placeholder="0"
            required
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">Requested amount (USD)</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={loanAmount}
            onChange={(event) => setLoanAmount(event.target.value)}
            placeholder="175000"
            required
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
          />
          <p className="mt-2 text-xs text-slate-500">Loans are capped at 70% LTV by the protocol.</p>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
        >
          {isLoading ? "Submitting..." : "Request loan"}
        </button>
      </form>

      {createdLoanId !== null && (
        <p className="mt-4 text-sm text-emerald-200">Loan created as position #{createdLoanId.toString()}.</p>
      )}

      {error && <p className="mt-4 text-sm text-rose-200">{error}</p>}
    </section>
  );
}
