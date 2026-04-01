"use client";

import { useEffect, useState } from "react";
import { ADDRESSES, getContracts, getReadProvider, getSigner } from "../lib/contracts";
import { encryptAmount, getOrCreateFhevmInstance, publicDecryptHandles, reencryptBalance } from "../lib/fhevm";
import type { DecryptedLoan, Loan } from "../lib/types";

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

const ASSET_TYPE_LABELS = ["TREASURY_BOND", "INVOICE", "REAL_ESTATE", "EQUITY"] as const;

type ProtocolAssetRow = {
  id: bigint;
  assetType: string;
  metadataURI: string;
  owner: string;
  locked: boolean;
  registeredAt: bigint;
};

type ProtocolStats = {
  totalAssets: number;
  totalLoans: number;
};

function truncateAddress(address?: string | null) {
  if (typeof address !== "string" || address.length === 0) {
    return "Unknown";
  }

  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimestamp(timestamp?: bigint | null) {
  if (typeof timestamp === "undefined" || timestamp === null) {
    return "Unknown date";
  }

  return new Date(Number(timestamp) * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function LoanDashboard() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [decryptedLoans, setDecryptedLoans] = useState<Record<string, DecryptedLoan>>({});
  const [protocolStats, setProtocolStats] = useState<ProtocolStats>({ totalAssets: 0, totalLoans: 0 });
  const [recentAssets, setRecentAssets] = useState<ProtocolAssetRow[]>([]);
  const [recentProtocolLoans, setRecentProtocolLoans] = useState<Loan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [decryptingId, setDecryptingId] = useState<bigint | null>(null);
  const [repayAmounts, setRepayAmounts] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard().catch(() => undefined);
  }, []);

  const mapLoan = (id: bigint, info: any): Loan => {
    const statusKey = typeof info?.status !== "undefined" ? info.status.toString() : "0";

    return {
      id,
      assetId: typeof info?.assetId === "bigint" ? info.assetId : BigInt(0),
      borrower: typeof info?.borrower === "string" ? info.borrower : "",
      status: (STATUS_LABELS[statusKey] ?? "NONE") as Loan["status"],
      interestRatePerYear: Number(info?.interestRatePerYear ?? 0),
      createdAt: typeof info?.createdAt === "bigint" ? info.createdAt : BigInt(0),
      lastAccrualAt: typeof info?.lastAccrualAt === "bigint" ? info.lastAccrualAt : BigInt(0),
    };
  };

  const loadDashboard = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { signer, address } = await getSigner();
      const signerContracts = getContracts(signer);
      const readContracts = getContracts(getReadProvider());

      const [loanIds, totalAssetsRaw, totalLoansRaw] = await Promise.all([
        signerContracts.privateLending.getBorrowerLoans(address),
        readContracts.rwaRegistry.totalAssets(),
        readContracts.privateLending.totalLoans(),
      ]);

      const [loadedLoans, assets, protocolLoans] = await Promise.all([
        Promise.all(
          (loanIds as bigint[]).map(async (id) => {
            const info = await signerContracts.privateLending.getLoanInfo(id);
            return mapLoan(id, info);
          }),
        ),
        Promise.all(
          Array.from(
            { length: Math.min(Number(totalAssetsRaw), 4) },
            (_, index) => BigInt(Number(totalAssetsRaw) - index - 1),
          ).map(async (id) => {
            const asset = await readContracts.rwaRegistry.getAsset(id);
            return {
              id,
              assetType: ASSET_TYPE_LABELS[Number(asset.assetType)] ?? "UNKNOWN",
              metadataURI: typeof asset.metadataURI === "string" ? asset.metadataURI : "Metadata unavailable",
              owner: typeof asset.assetOwner === "string" ? asset.assetOwner : "",
              locked: Boolean(asset.locked),
              registeredAt: typeof asset.registeredAt === "bigint" ? asset.registeredAt : BigInt(0),
            } satisfies ProtocolAssetRow;
          }),
        ),
        Promise.all(
          Array.from(
            { length: Math.min(Number(totalLoansRaw), 4) },
            (_, index) => BigInt(Number(totalLoansRaw) - index - 1),
          ).map(async (id) => {
            const info = await readContracts.privateLending.getLoanInfo(id);
            return mapLoan(id, info);
          }),
        ),
      ]);

      setLoans(loadedLoans);
      setProtocolStats({
        totalAssets: Number(totalAssetsRaw),
        totalLoans: Number(totalLoansRaw),
      });
      setRecentAssets(assets);
      setRecentProtocolLoans(protocolLoans);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDecrypt = async (loanId: bigint) => {
    setDecryptingId(loanId);
    try {
      const { signer } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance();
      const lendingAddress = ADDRESSES.privateLending;

      const [principalH, outstandingH, collateralH, liquidationH] =
        await contracts.privateLending.getEncryptedLoanFields(loanId);

      const [principal, outstandingBalance, collateralValue, liquidationThreshold] = await Promise.all([
        reencryptBalance(inst, signer, lendingAddress, principalH),
        reencryptBalance(inst, signer, lendingAddress, outstandingH),
        reencryptBalance(inst, signer, lendingAddress, collateralH),
        reencryptBalance(inst, signer, lendingAddress, liquidationH),
      ]);

      const loan = loans.find((currentLoan) => currentLoan.id === loanId);
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
      const { signer, address } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance();
      const lendingAddress = ADDRESSES.privateLending;

      const amountMicro = BigInt(Math.round(parseFloat(amount) * 1_000_000));
      const { handle, inputProof } = await encryptAmount(inst, lendingAddress, address, amountMicro);

      const tx = await contracts.privateLending.repayLoan(loanId, handle, inputProof);
      await tx.wait();
      const repaymentStatusHandle = await contracts.privateLending.getPendingRepaymentStatusHandle(loanId);
      const repaymentStatus = await publicDecryptHandles(inst, [repaymentStatusHandle]);
      const finalizeTx = await contracts.privateLending.finalizeRepayment(
        loanId,
        repaymentStatus.abiEncodedClearValues,
        repaymentStatus.decryptionProof,
      );
      await finalizeTx.wait();
      await loadDashboard();
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
      const inst = await getOrCreateFhevmInstance();
      const tx = await contracts.privateLending.checkAndLiquidate(loanId);
      await tx.wait();
      const liquidationDecisionHandle = await contracts.privateLending.getPendingLiquidationDecisionHandle(loanId);
      const liquidationDecision = await publicDecryptHandles(inst, [liquidationDecisionHandle]);
      const finalizeTx = await contracts.privateLending.finalizeLiquidation(
        loanId,
        liquidationDecision.abiEncodedClearValues,
        liquidationDecision.decryptionProof,
      );
      await finalizeTx.wait();
      await loadDashboard();
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
      await loadDashboard();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Accrue interest failed");
    } finally {
      setActionLoading((prev) => ({ ...prev, [`accrue_${loanId}`]: false }));
    }
  };

  const formatMicro = (val: bigint): string =>
    (Number(val) / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2 });

  return (
    <div className="w-full space-y-6">
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Protocol Dashboard</h2>
            <p className="mt-1 text-sm text-gray-400">
              Registered assets and loans are optionally confidential, powered by Zama's FHEVM. Visible metadata is displayed for reference.
            </p>
          </div>
          <button
            onClick={() => loadDashboard().catch(() => undefined)}
            className="text-sm text-indigo-400 transition-colors hover:text-indigo-300"
          >
            ↻ Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-700 bg-red-900/30 p-3">
            <p className="text-sm text-red-300">❌ {error}</p>
          </div>
        )}

        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Registered Assets</p>
            <p className="mt-2 text-3xl font-bold text-white">{protocolStats.totalAssets}</p>
            <p className="mt-1 text-sm text-gray-400">Treasuries, invoices and real estate positions</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Protocol Loans</p>
            <p className="mt-2 text-3xl font-bold text-white">{protocolStats.totalLoans}</p>
            <p className="mt-1 text-sm text-gray-400">Encrypted lending positions created on testnet</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-white">Recent Assets</h3>
              <span className="text-xs text-gray-500">Visible metadata only</span>
            </div>
            <div className="space-y-3">
              {recentAssets.length === 0 ? (
                <p className="text-sm text-gray-500">No assets yet.</p>
              ) : (
                recentAssets.map((asset) => (
                  <div key={asset.id.toString()} className="rounded-lg border border-gray-800 bg-gray-900/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">
                          Asset #{asset.id.toString()} · {asset.assetType.replace("_", " ")}
                        </p>
                        <p className="mt-1 text-xs text-gray-400">{asset.metadataURI}</p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                          asset.locked ? "bg-amber-500/10 text-amber-300" : "bg-emerald-500/10 text-emerald-300"
                        }`}
                      >
                        {asset.locked ? "Locked" : "Available"}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                      <span>Owner {truncateAddress(asset.owner)}</span>
                      <span>{formatTimestamp(asset.registeredAt)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-white">Recent Loans</h3>
              <span className="text-xs text-gray-500">Public protocol metadata</span>
            </div>
            <div className="space-y-3">
              {recentProtocolLoans.length === 0 ? (
                <p className="text-sm text-gray-500">No loans yet.</p>
              ) : (
                recentProtocolLoans.map((loan) => (
                  <div key={loan.id.toString()} className="rounded-lg border border-gray-800 bg-gray-900/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">
                          Loan #{loan.id.toString()} · Asset #{loan.assetId.toString()}
                        </p>
                        <p className="mt-1 text-xs text-gray-400">Borrower {truncateAddress(loan.borrower)}</p>
                      </div>
                      <span
                        className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                          STATUS_COLORS[
                            loan.status === "NONE"
                              ? "0"
                              : loan.status === "ACTIVE"
                                ? "1"
                                : loan.status === "REPAID"
                                  ? "2"
                                  : "3"
                          ]
                        }`}
                      >
                        {loan.status}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                      <span>{(loan.interestRatePerYear / 100).toFixed(2)}% APR</span>
                      <span>{formatTimestamp(loan.createdAt)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">My Loans</h2>
            <p className="mt-1 text-sm text-gray-400">Decrypt, repay and monitor your confidential borrowing positions.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-gray-400">Loading loans...</div>
        ) : loans.length === 0 ? (
          <div className="py-8 text-center text-gray-500">No personal loans yet. Use the assets or request a new loan.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="px-2 py-3 text-left">Loan ID</th>
                  <th className="px-2 py-3 text-left">Asset</th>
                  <th className="px-2 py-3 text-left">Status</th>
                  <th className="px-2 py-3 text-left">Rate</th>
                  <th className="px-2 py-3 text-left">Details</th>
                  <th className="px-2 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => {
                  const idStr = loan.id.toString();
                  const decrypted = decryptedLoans[idStr];
                  const isDecrypting = decryptingId === loan.id;

                  return (
                    <tr key={idStr} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                      <td className="px-2 py-3 font-mono text-white">{idStr}</td>
                      <td className="px-2 py-3 font-mono text-gray-300">{loan.assetId.toString()}</td>
                      <td
                        className={`px-2 py-3 font-medium ${
                          STATUS_COLORS[
                            loan.status === "NONE"
                              ? "0"
                              : loan.status === "ACTIVE"
                                ? "1"
                                : loan.status === "REPAID"
                                  ? "2"
                                  : "3"
                          ]
                        }`}
                      >
                        {loan.status}
                      </td>
                      <td className="px-2 py-3 text-gray-300">{(loan.interestRatePerYear / 100).toFixed(2)}%</td>
                      <td className="px-2 py-3">
                        {decrypted ? (
                          <div className="space-y-1 text-xs">
                            <div className="text-gray-300">
                              🔓 Principal: <span className="text-white">{formatMicro(decrypted.principal)} sUSD</span>
                            </div>
                            <div className="text-gray-300">
                              🔓 Outstanding:{" "}
                              <span className="text-yellow-300">{formatMicro(decrypted.outstandingBalance)} sUSD</span>
                            </div>
                            <div className="text-gray-300">
                              🔓 LiqThreshold:{" "}
                              <span className="text-red-300">{formatMicro(decrypted.liquidationThreshold)} sUSD</span>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleDecrypt(loan.id)}
                            disabled={isDecrypting}
                            className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300"
                          >
                            {isDecrypting ? "Decrypting..." : "🔒 Encrypted — Decrypt Details"}
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        {loan.status === "ACTIVE" && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                value={repayAmounts[idStr] ?? ""}
                                onChange={(event) =>
                                  setRepayAmounts((prev) => ({ ...prev, [idStr]: event.target.value }))
                                }
                                placeholder="Amount (USD)"
                                className="w-28 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                              />
                              <button
                                onClick={() => handleRepay(loan.id)}
                                disabled={actionLoading[idStr]}
                                className="rounded bg-indigo-600 px-3 py-1 text-xs text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                              >
                                {actionLoading[idStr] ? "..." : "Repay"}
                              </button>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleLiquidationCheck(loan.id)}
                                disabled={actionLoading[`liq_${loan.id}`]}
                                className="rounded bg-red-900/50 px-2 py-1 text-xs text-red-300 transition-colors hover:bg-red-900 disabled:opacity-50"
                              >
                                {actionLoading[`liq_${loan.id}`] ? "..." : "Check Liq."}
                              </button>
                              <button
                                onClick={() => handleAccrueInterest(loan.id)}
                                disabled={actionLoading[`accrue_${loan.id}`]}
                                className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-600 disabled:opacity-50"
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
      </section>
    </div>
  );
}
