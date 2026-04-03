"use client";

import { useEffect, useState } from "react";
import { getContracts, getReadProvider } from "../lib/contracts";
import { normalizeError } from "../lib/errors";
import { formatCompactNumber, formatDate, shortenValue, truncateAddress } from "../lib/format";
import { getExplorerAddressUrl } from "../lib/protocol-config";

const STATUS_LABELS: Record<string, string> = {
  "0": "None",
  "1": "Active",
  "2": "Repaid",
  "3": "Liquidated",
};

const ASSET_TYPE_LABELS = ["Treasury Bond", "Invoice", "Real Estate", "Equity"] as const;

type ProtocolAssetRow = {
  id: bigint;
  assetType: string;
  metadataURI: string;
  owner: string;
  locked: boolean;
  registeredAt: bigint;
};

type ProtocolLoanRow = {
  id: bigint;
  assetId: bigint;
  borrower: string;
  status: string;
  interestRatePerYear: number;
  createdAt: bigint;
};

type ProtocolStats = {
  totalAssets: number | null;
  totalLoans: number | null;
  activeLoans: number | null;
};

interface LoanDashboardProps {
  refreshVersion?: number;
}

export default function LoanDashboard({ refreshVersion = 0 }: LoanDashboardProps) {
  const [stats, setStats] = useState<ProtocolStats>({
    totalAssets: null,
    totalLoans: null,
    activeLoans: null,
  });
  const [recentAssets, setRecentAssets] = useState<ProtocolAssetRow[]>([]);
  const [recentLoans, setRecentLoans] = useState<ProtocolLoanRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSnapshot().catch(() => undefined);
  }, [refreshVersion]);

  async function loadSnapshot() {
    setIsLoading(true);
    setError(null);

    try {
      const contracts = getContracts(getReadProvider());
      const [totalAssetsRaw, totalLoansRaw] = await Promise.all([
        contracts.rwaRegistry.totalAssets(),
        contracts.privateLending.totalLoans(),
      ]);

      const totalAssets = Number(totalAssetsRaw);
      const totalLoans = Number(totalLoansRaw);

      const assetIds = Array.from(
        { length: Math.min(totalAssets, 6) },
        (_, index) => BigInt(totalAssets - index - 1),
      );

      const loanIds = Array.from(
        { length: Math.min(totalLoans, 6) },
        (_, index) => BigInt(totalLoans - index - 1),
      );

      const loanStatusIds = Array.from({ length: totalLoans }, (_, index) => BigInt(index));

      const [assets, loans, allStatuses] = await Promise.all([
        Promise.all(
          assetIds.map(async (assetId) => {
            const asset = await contracts.rwaRegistry.getAsset(assetId);

            return {
              id: assetId,
              assetType: ASSET_TYPE_LABELS[Number(asset.assetType)] ?? "Unknown",
              metadataURI: asset.metadataURI,
              owner: asset.assetOwner,
              locked: asset.locked,
              registeredAt: asset.registeredAt,
            } satisfies ProtocolAssetRow;
          }),
        ),
        Promise.all(
          loanIds.map(async (loanId) => {
            const loan = await contracts.privateLending.getLoanInfo(loanId);

            return {
              id: loanId,
              assetId: loan.assetId,
              borrower: loan.borrower,
              status: STATUS_LABELS[loan.status.toString()] ?? "Unknown",
              interestRatePerYear: Number(loan.interestRatePerYear),
              createdAt: loan.createdAt,
            } satisfies ProtocolLoanRow;
          }),
        ),
        Promise.all(
          loanStatusIds.map((loanId) => contracts.privateLending.getLoanStatus(loanId)),
        ),
      ]);

      setStats({
        totalAssets,
        totalLoans,
        activeLoans: allStatuses.filter((status) => status.toString() === "1").length,
      });
      setRecentAssets(assets);
      setRecentLoans(loans);
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="space-y-6 rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.45)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">Live Protocol</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Sepolia activity from the deployed contracts</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            ShieldCredit reads directly from the live RWA registry, lending, stablecoin, and faucet
            contracts. No mock balances, placeholders, or simulations are shown here.
          </p>
        </div>
        <button
          onClick={() => loadSnapshot().catch(() => undefined)}
          className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:border-white/20 hover:text-white"
        >
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Registered Assets" value={formatCompactNumber(stats.totalAssets)} />
        <MetricCard label="Total Loans" value={formatCompactNumber(stats.totalLoans)} />
        <MetricCard label="Active Loans" value={formatCompactNumber(stats.activeLoans)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">Recent collateral</h3>
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Registry</span>
          </div>
          <div className="mt-4 space-y-3">
            {recentAssets.length === 0 ? (
              <p className="text-sm text-slate-500">No assets have been registered yet.</p>
            ) : (
              recentAssets.map((asset) => (
                <div
                  key={asset.id.toString()}
                  className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-white">
                        Asset #{asset.id.toString()} · {asset.assetType}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">{shortenValue(asset.metadataURI)}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        asset.locked
                          ? "bg-amber-500/10 text-amber-200"
                          : "bg-emerald-500/10 text-emerald-200"
                      }`}
                    >
                      {asset.locked ? "Locked" : "Available"}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <a
                      href={getExplorerAddressUrl(asset.owner)}
                      target="_blank"
                      rel="noreferrer"
                      className="transition hover:text-white"
                    >
                      {truncateAddress(asset.owner)}
                    </a>
                    <span>{formatDate(asset.registeredAt)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">Recent loans</h3>
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Lending</span>
          </div>
          <div className="mt-4 space-y-3">
            {recentLoans.length === 0 ? (
              <p className="text-sm text-slate-500">No loans have been opened yet.</p>
            ) : (
              recentLoans.map((loan) => (
                <div
                  key={loan.id.toString()}
                  className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-white">
                        Loan #{loan.id.toString()} · Asset #{loan.assetId.toString()}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        Borrower {truncateAddress(loan.borrower)}
                      </p>
                    </div>
                    <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-200">
                      {loan.status}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span>{(loan.interestRatePerYear / 100).toFixed(2)}% APR</span>
                    <span>{formatDate(loan.createdAt)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
    </div>
  );
}
