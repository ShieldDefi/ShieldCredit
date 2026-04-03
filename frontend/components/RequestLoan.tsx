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
  const [isLoading, setIsLoading] = useState(false);
  const [createdLoanId, setCreatedLoanId] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
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

      const lendingAddress = await contracts.privateLending.getAddress();
      const loanAmountMicro = parseUsdToMicro(loanAmount);
      const { handle, inputProof } = await encryptAmount(inst, lendingAddress, address, loanAmountMicro);

      const tx = await contracts.privateLending.requestLoan(BigInt(assetIdValue), handle, inputProof);
      const receipt = await tx.wait();
      const eventLog = receipt?.logs?.find(
        (log: { fragment?: { name: string } }) => log?.fragment?.name === "LoanCreated",
      );
      const loanId = (eventLog as { args?: [bigint] })?.args?.[0] ?? BigInt(0);
      setCreatedLoanId(loanId);
      onSuccess?.();
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-6">
      <h2 className="mb-2 text-xl font-bold text-white">Request a Loan</h2>

      <div className="mb-6 rounded-lg border border-amber-700/50 bg-amber-900/20 p-3">
        <p className="text-sm text-amber-300">
          ⚠️ Loan amount, balance, and liquidation threshold are encrypted — visible only to you
          and the regulator
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Asset ID</label>
          <input
            type="number"
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
            placeholder="e.g. 0"
            min="0"
            required
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Loan Amount (USD)</label>
          <input
            type="number"
            value={loanAmount}
            onChange={(event) => setLoanAmount(event.target.value)}
            placeholder="e.g. 7000"
            min="1"
            step="0.01"
            required
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-gray-500">Maximum 70% of asset face value</p>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-lg bg-gradient-to-r from-indigo-500 to-cyan-500 py-2.5 font-semibold text-white shadow-lg transition-all duration-200 hover:from-indigo-600 hover:to-cyan-600 disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Encrypting & Submitting...
            </span>
          ) : (
            "Request Loan"
          )}
        </button>
      </form>

      {createdLoanId !== null && (
        <div className="mt-4 rounded-lg border border-green-700 bg-green-900/30 p-4">
          <p className="font-medium text-green-300">✅ Loan Created Successfully</p>
          <p className="mt-1 text-sm text-green-400">
            Loan ID: <span className="font-mono">{createdLoanId.toString()}</span>
          </p>
          <p className="mt-1 text-xs text-green-500">Your stablecoin disbursement is processing</p>
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
