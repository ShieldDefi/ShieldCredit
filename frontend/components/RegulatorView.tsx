"use client";

import { useState } from "react";
import { getSigner, getContracts, ADDRESSES } from "../lib/contracts";
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
      const { signer, address, provider } = await getSigner();
      const contracts = getContracts(signer);

      // Verify caller is regulator
      const regulatorAddress: string = await contracts.privateLending.regulator();
      if (address.toLowerCase() !== regulatorAddress.toLowerCase()) {
        throw new Error("Access denied: Only the designated regulator can use this view.");
      }

      const inst = await getOrCreateFhevmInstance(provider);
      const lendingAddress = ADDRESSES.privateLending;
      const loanIdBig = BigInt(loanId);

      const [principalH, outstandingH, , liquidationH] =
        await contracts.privateLending.getEncryptedLoanFields(loanIdBig);

      const loanInfo = await contracts.privateLending.getLoanInfo(loanIdBig);

      const signerObj = {
        address,
        signTypedData: (domain: object, types: object, value: object) =>
          signer.signTypedData(domain, types as Record<string, { name: string; type: string }[]>, value),
      };

      const [principal, outstandingBalance, liquidationThreshold] = await Promise.all([
        reencryptBalance(inst, signerObj, lendingAddress, principalH),
        reencryptBalance(inst, signerObj, lendingAddress, outstandingH),
        reencryptBalance(inst, signerObj, lendingAddress, liquidationH),
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
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-2xl w-full">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-yellow-400 text-xl">⚠️</span>
        <h2 className="text-xl font-bold text-white">Regulator Access — Selective Decryption Only</h2>
      </div>
      <p className="text-sm text-gray-400 mb-6">
        Access is traceable on-chain. Available only to the designated regulator address.
      </p>

      <form onSubmit={handleAudit} className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Borrower Address</label>
          <input
            type="text"
            value={borrowerAddress}
            onChange={(e) => setBorrowerAddress(e.target.value)}
            placeholder="0x..."
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-500 placeholder-gray-500 font-mono text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Loan ID</label>
          <input
            type="number"
            value={loanId}
            onChange={(e) => setLoanId(e.target.value)}
            placeholder="e.g. 0"
            min="0"
            required
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-500 placeholder-gray-500"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-700 hover:to-orange-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-all duration-200"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
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
        <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg mb-4">
          <p className="text-red-300 text-sm">❌ {error}</p>
        </div>
      )}

      {auditReport && (
        <div className="p-5 bg-yellow-900/10 border border-yellow-700/50 rounded-xl">
          <h3 className="text-yellow-300 font-bold mb-4">📋 Audit Report</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Loan ID</span>
              <span className="text-white font-mono">{auditReport.loanId.toString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Borrower</span>
              <span className="text-white font-mono text-xs">{auditReport.borrower}</span>
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
          <p className="text-xs text-gray-500 mt-4">
            ⚠️ Access traceable on-chain. Available only to the designated regulator address.
          </p>
        </div>
      )}
    </div>
  );
}
