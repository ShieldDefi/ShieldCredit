"use client";

import { useState } from "react";
import { getSigner, getContracts } from "../lib/contracts";
import { getOrCreateFhevmInstance, encryptAmount } from "../lib/fhevm";

export default function RequestLoan() {
  const [assetId, setAssetId] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [createdLoanId, setCreatedLoanId] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setCreatedLoanId(null);

    try {
      const { signer, address, provider } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance(provider);

      const lendingAddress = await contracts.privateLending.getAddress();
      const loanAmountMicro = BigInt(Math.round(parseFloat(loanAmount) * 1_000_000));
      const { handle, inputProof } = await encryptAmount(
        inst,
        lendingAddress,
        address,
        loanAmountMicro
      );

      const tx = await contracts.privateLending.requestLoan(
        BigInt(assetId),
        handle,
        inputProof
      );
      const receipt = await tx.wait();

      const event = receipt?.logs?.find(
        (log: { fragment?: { name: string } }) => log?.fragment?.name === "LoanCreated"
      );
      const loanId: bigint = (event as { args?: [bigint] })?.args?.[0] ?? 0n;
      setCreatedLoanId(loanId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-lg w-full">
      <h2 className="text-xl font-bold text-white mb-2">Request a Loan</h2>

      <div className="mb-6 p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg">
        <p className="text-amber-300 text-sm">
          ⚠️ Loan amount, balance and liquidation threshold are encrypted — visible only to you and the regulator
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Asset ID</label>
          <input
            type="number"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            placeholder="e.g. 0"
            min="0"
            required
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Loan Amount (USD)</label>
          <input
            type="number"
            value={loanAmount}
            onChange={(e) => setLoanAmount(e.target.value)}
            placeholder="e.g. 7000"
            min="1"
            step="0.01"
            required
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
          />
          <p className="text-xs text-gray-500 mt-1">Maximum 70% of asset face value</p>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-all duration-200 shadow-lg"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
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
        <div className="mt-4 p-4 bg-green-900/30 border border-green-700 rounded-lg">
          <p className="text-green-300 font-medium">✅ Loan Created Successfully</p>
          <p className="text-sm text-green-400 mt-1">Loan ID: <span className="font-mono">{createdLoanId.toString()}</span></p>
          <p className="text-xs text-green-500 mt-1">Your stablecoin disbursement is processing</p>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-900/30 border border-red-700 rounded-lg">
          <p className="text-red-300 text-sm">❌ {error}</p>
        </div>
      )}
    </div>
  );
}
