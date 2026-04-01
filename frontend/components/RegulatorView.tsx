"use client";

import { useState } from "react";
import { ADDRESSES, getContracts, getSigner } from "../lib/contracts";
import { getOrCreateFhevmInstance, reencryptBalance } from "../lib/fhevm";

interface AuditReport {
  loanId: bigint;
  borrower: string;
  principal: bigint;
  outstandingBalance: bigint;
  liquidationThreshold: bigint;
}

export default function RegulatorView() {
  const [borrowerAddress, setBorrowerAddress] = useState("");
  const [loanId, setLoanId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setAuditReport(null);

    try {
      const { signer, address } = await getSigner();
      const contracts = getContracts(signer);

      const regulatorAddress: string = await contracts.privateLending.regulator();
      if (address.toLowerCase() !== regulatorAddress.toLowerCase()) {
        throw new Error("Access denied: Only the designated regulator can use this view.");
      }

      const inst = await getOrCreateFhevmInstance();
      const lendingAddress = ADDRESSES.privateLending;
      const loanIdBig = BigInt(loanId);

      const [principalH, outstandingH, , liquidationH] =
        await contracts.privateLending.getEncryptedLoanFields(loanIdBig);

      const loanInfo = await contracts.privateLending.getLoanInfo(loanIdBig);

      const [principal, outstandingBalance, liquidationThreshold] = await Promise.all([
        reencryptBalance(inst, signer, lendingAddress, principalH),
        reencryptBalance(inst, signer, lendingAddress, outstandingH),
        reencryptBalance(inst, signer, lendingAddress, liquidationH),
      ]);

      setAuditReport({
        loanId: loanIdBig,
        borrower: loanInfo.borrower,
        principal,
        outstandingBalance,
        liquidationThreshold,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Audit failed");
    } finally {
      setIsLoading(false);
    }
  };

  const formatMicro = (val: bigint): string =>
    (Number(val) / 1_000_000).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });

  return (
    <div className="w-full max-w-2xl rounded-xl border border-gray-800 bg-gray-900 p-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xl text-yellow-400">⚠️</span>
        <h2 className="text-xl font-bold text-white">Regulator Access — Selective Decryption Only</h2>
      </div>
      <p className="mb-6 text-sm text-gray-400">
        Access is traceable on-chain. Available only to the designated regulator address.
      </p>

      <form onSubmit={handleAudit} className="mb-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Borrower Address</label>
          <input
            type="text"
            value={borrowerAddress}
            onChange={(e) => setBorrowerAddress(e.target.value)}
            placeholder="0x..."
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Loan ID</label>
          <input
            type="number"
            value={loanId}
            onChange={(e) => setLoanId(e.target.value)}
            placeholder="e.g. 0"
            min="0"
            required
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-500"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-lg bg-gradient-to-r from-yellow-600 to-orange-600 py-2.5 font-semibold text-white transition-all duration-200 hover:from-yellow-700 hover:to-orange-700 disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Auditing...
            </span>
          ) : (
            "Generate Audit Report"
          )}
        </button>
      </form>

      {error && (
        <div className="mb-4 rounded-lg border border-red-700 bg-red-900/30 p-4">
          <p className="text-sm text-red-300">❌ {error}</p>
        </div>
      )}

      {auditReport && (
        <div className="rounded-xl border border-yellow-700/50 bg-yellow-900/10 p-5">
          <h3 className="mb-4 font-bold text-yellow-300">📋 Audit Report</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Loan ID</span>
              <span className="font-mono text-white">{auditReport.loanId.toString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Borrower</span>
              <span className="font-mono text-xs text-white">{auditReport.borrower}</span>
            </div>
            <hr className="border-gray-700" />
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Principal</span>
              <span className="text-white">{formatMicro(auditReport.principal)} sUSD</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Outstanding Balance</span>
              <span className="text-yellow-300">{formatMicro(auditReport.outstandingBalance)} sUSD</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Liquidation Threshold</span>
              <span className="text-red-300">{formatMicro(auditReport.liquidationThreshold)} sUSD</span>
            </div>
          </div>
          <p className="mt-4 text-xs text-gray-500">
            ⚠️ Access traceable on-chain. Available only to the designated regulator address.
          </p>
        </div>
      )}
    </div>
  );
}
