"use client";

import { useState, useEffect } from "react";
import { getSigner, getContracts } from "../lib/contracts";
import { getOrCreateFhevmInstance, encryptAmount, reencryptBalance } from "../lib/fhevm";
import { ADDRESSES } from "../lib/contracts";
import type { Loan, DecryptedLoan } from "../lib/types";

const STATUS_LABELS: Record<string, string> = {
  "0": "NONE",
  "1": "ACTIVE",
  "2": "REPAID",
  "3": "LIQUIDATED",
};

const STATUS_COLORS: Record<string, string> = {
  "0": "text-gray-400",
  "1": "text-green-400",
  "2": "text-blue-400",
  "3": "text-red-400",
};

export default function LoanDashboard() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [decryptedLoans, setDecryptedLoans] = useState<Record<string, DecryptedLoan>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [decryptingId, setDecryptingId] = useState<bigint | null>(null);
  const [repayAmounts, setRepayAmounts] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLoans();
  }, []);

  const loadLoans = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { signer, address } = await getSigner();
      const contracts = getContracts(signer);
      const loanIds: bigint[] = await contracts.privateLending.getBorrowerLoans(address);

      const loadedLoans: Loan[] = await Promise.all(
        loanIds.map(async (id) => {
          const info = await contracts.privateLending.getLoanInfo(id);
          return {
            id,
            assetId: info.assetId,
            borrower: info.borrower,
            status: STATUS_LABELS[info.status.toString()] as Loan["status"],
            interestRatePerYear: Number(info.interestRatePerYear),
            createdAt: info.createdAt,
            lastAccrualAt: info.lastAccrualAt,
          };
        })
      );

      setLoans(loadedLoans);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load loans");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDecrypt = async (loanId: bigint) => {
    setDecryptingId(loanId);
    try {
      const { signer, address, provider } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance(provider);
      const lendingAddress = ADDRESSES.privateLending;

      const [principalH, outstandingH, collateralH, liquidationH] =
        await contracts.privateLending.getEncryptedLoanFields(loanId);

      const signerObj = {
        address,
        signTypedData: (domain: object, types: object, value: object) =>
          signer.signTypedData(domain, types as Record<string, { name: string; type: string }[]>, value),
      };

      const [principal, outstandingBalance, collateralValue, liquidationThreshold] =
        await Promise.all([
          reencryptBalance(inst, signerObj, lendingAddress, principalH),
          reencryptBalance(inst, signerObj, lendingAddress, outstandingH),
          reencryptBalance(inst, signerObj, lendingAddress, collateralH),
          reencryptBalance(inst, signerObj, lendingAddress, liquidationH),
        ]);

      const loan = loans.find((l) => l.id === loanId);
      if (!loan) return;

      setDecryptedLoans((prev) => ({
        ...prev,
        [loanId.toString()]: {
          ...loan,
          principal,
          outstandingBalance,
          collateralValue,
          liquidationThreshold,
        },
      }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to decrypt");
    } finally {
      setDecryptingId(null);
    }
  };

  const handleRepay = async (loanId: bigint) => {
    const amount = repayAmounts[loanId.toString()];
    if (!amount) return;

    setActionLoading((prev) => ({ ...prev, [loanId.toString()]: true }));
    try {
      const { signer, address, provider } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance(provider);
      const lendingAddress = ADDRESSES.privateLending;

      const amountMicro = BigInt(Math.round(parseFloat(amount) * 1_000_000));
      const { handles, inputProof } = await encryptAmount(inst, lendingAddress, address, amountMicro);

      const tx = await contracts.privateLending.repayLoan(loanId, handles[0], inputProof);
      await tx.wait();
      await loadLoans();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Repay failed");
    } finally {
      setActionLoading((prev) => ({ ...prev, [loanId.toString()]: false }));
    }
  };

  const handleLiquidationCheck = async (loanId: bigint) => {
    setActionLoading((prev) => ({ ...prev, [`liq_${loanId}`]: true }));
    try {
      const { signer } = await getSigner();
      const contracts = getContracts(signer);
      const tx = await contracts.privateLending.checkAndLiquidate(loanId);
      await tx.wait();
      await loadLoans();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Liquidation check failed");
    } finally {
      setActionLoading((prev) => ({ ...prev, [`liq_${loanId}`]: false }));
    }
  };

  const handleAccrueInterest = async (loanId: bigint) => {
    setActionLoading((prev) => ({ ...prev, [`accrue_${loanId}`]: true }));
    try {
      const { signer } = await getSigner();
      const contracts = getContracts(signer);
      const tx = await contracts.privateLending.accrueInterest(loanId);
      await tx.wait();
      await loadLoans();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Accrue interest failed");
    } finally {
      setActionLoading((prev) => ({ ...prev, [`accrue_${loanId}`]: false }));
    }
  };

  const formatMicro = (val: bigint): string =>
    (Number(val) / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2 });

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">My Loans</h2>
        <button
          onClick={loadLoans}
          className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg">
          <p className="text-red-300 text-sm">❌ {error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-gray-400">Loading loans...</div>
      ) : loans.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No loans found. Request a loan to get started.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="text-left py-3 px-2">Loan ID</th>
                <th className="text-left py-3 px-2">Asset</th>
                <th className="text-left py-3 px-2">Status</th>
                <th className="text-left py-3 px-2">Rate</th>
                <th className="text-left py-3 px-2">Details</th>
                <th className="text-left py-3 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => {
                const idStr = loan.id.toString();
                const decrypted = decryptedLoans[idStr];
                const isDecrypting = decryptingId === loan.id;

                return (
                  <tr key={idStr} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                    <td className="py-3 px-2 font-mono text-white">{idStr}</td>
                    <td className="py-3 px-2 font-mono text-gray-300">{loan.assetId.toString()}</td>
                    <td className={`py-3 px-2 font-medium ${STATUS_COLORS[loan.status === "NONE" ? "0" : loan.status === "ACTIVE" ? "1" : loan.status === "REPAID" ? "2" : "3"]}`}>
                      {loan.status}
                    </td>
                    <td className="py-3 px-2 text-gray-300">{(loan.interestRatePerYear / 100).toFixed(2)}%</td>
                    <td className="py-3 px-2">
                      {decrypted ? (
                        <div className="text-xs space-y-1">
                          <div className="text-gray-300">🔓 Principal: <span className="text-white">{formatMicro(decrypted.principal)} sUSD</span></div>
                          <div className="text-gray-300">🔓 Outstanding: <span className="text-yellow-300">{formatMicro(decrypted.outstandingBalance)} sUSD</span></div>
                          <div className="text-gray-300">🔓 LiqThreshold: <span className="text-red-300">{formatMicro(decrypted.liquidationThreshold)} sUSD</span></div>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDecrypt(loan.id)}
                          disabled={isDecrypting}
                          className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                        >
                          {isDecrypting ? "Decrypting..." : "🔒 Encrypted — Decrypt Details"}
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      {loan.status === "ACTIVE" && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={repayAmounts[idStr] ?? ""}
                              onChange={(e) =>
                                setRepayAmounts((prev) => ({ ...prev, [idStr]: e.target.value }))
                              }
                              placeholder="Amount (USD)"
                              className="text-xs bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 w-28"
                            />
                            <button
                              onClick={() => handleRepay(loan.id)}
                              disabled={actionLoading[idStr]}
                              className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded transition-colors disabled:opacity-50"
                            >
                              {actionLoading[idStr] ? "..." : "Repay"}
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleLiquidationCheck(loan.id)}
                              disabled={actionLoading[`liq_${loan.id}`]}
                              className="text-xs bg-red-900/50 hover:bg-red-900 text-red-300 px-2 py-1 rounded transition-colors disabled:opacity-50"
                            >
                              {actionLoading[`liq_${loan.id}`] ? "..." : "Check Liq."}
                            </button>
                            <button
                              onClick={() => handleAccrueInterest(loan.id)}
                              disabled={actionLoading[`accrue_${loan.id}`]}
                              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition-colors disabled:opacity-50"
                            >
                              {actionLoading[`accrue_${loan.id}`] ? "..." : "Accrue"}
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
