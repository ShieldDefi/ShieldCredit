"use client";

import { useEffect, useState } from "react";
import { ADDRESSES, getContracts, getReadProvider, getSigner } from "../lib/contracts";
import { normalizeError } from "../lib/errors";
import { formatDate, formatUsdMicro, parseUsdToMicro, truncateAddress } from "../lib/format";
import {
  encryptAmount,
  getOrCreateFhevmInstance,
  publicDecryptHandles,
  reencryptBalance,
} from "../lib/fhevm";
import type { DecryptedLoan, Loan } from "../lib/types";
import StablecoinFaucet from "./StablecoinFaucet";

const STATUS_LABELS: Record<string, Loan["status"]> = {
  "0": "NONE",
  "1": "ACTIVE",
  "2": "REPAID",
  "3": "LIQUIDATED",
};

const STATUS_STYLES: Record<Loan["status"], string> = {
  NONE: "bg-white/5 text-slate-300",
  ACTIVE: "bg-emerald-500/10 text-emerald-200",
  REPAID: "bg-blue-500/10 text-blue-200",
  LIQUIDATED: "bg-rose-500/10 text-rose-200",
};

interface AccountPanelProps {
  connectedAddress: string;
  refreshVersion?: number;
}

export default function AccountPanel({
  connectedAddress,
  refreshVersion = 0,
}: AccountPanelProps) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [creditScore, setCreditScore] = useState<bigint | null>(null);
  const [ownedAssetIds, setOwnedAssetIds] = useState<bigint[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [decryptedLoans, setDecryptedLoans] = useState<Record<string, DecryptedLoan>>({});
  const [repayAmounts, setRepayAmounts] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [decryptingId, setDecryptingId] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAccount().catch(() => undefined);
  }, [connectedAddress, refreshVersion]);

  function mapLoan(id: bigint, info: any): Loan {
    const status = STATUS_LABELS[info.status?.toString?.() ?? "0"] ?? "NONE";

    return {
      id,
      assetId: info.assetId,
      borrower: info.borrower,
      status,
      interestRatePerYear: Number(info.interestRatePerYear),
      createdAt: info.createdAt,
      lastAccrualAt: info.lastAccrualAt,
    };
  }

  async function loadAccount() {
    setIsLoading(true);
    setError(null);

    try {
      const { signer, address } = await getSigner();
      const signerContracts = getContracts(signer);
      const readContracts = getContracts(getReadProvider());
      const inst = await getOrCreateFhevmInstance();

      const [balanceHandle, scoreInitialized, loanIds, totalAssetsRaw] = await Promise.all([
        signerContracts.stablecoin.balanceOf(address),
        signerContracts.creditScore.initialized(address),
        signerContracts.privateLending.getBorrowerLoans(address),
        readContracts.rwaRegistry.totalAssets(),
      ]);

      const [nextBalance, nextScore, nextLoans, nextOwnedAssetIds] = await Promise.all([
        reencryptBalance(inst, signer, ADDRESSES.stablecoin, balanceHandle),
        scoreInitialized
          ? (async () => {
              const scoreHandle = await signerContracts.creditScore.getEncryptedScore(address);
              return reencryptBalance(inst, signer, ADDRESSES.creditScore, scoreHandle);
            })()
          : Promise.resolve(null),
        Promise.all(
          (loanIds as bigint[]).map(async (loanId) => {
            const info = await signerContracts.privateLending.getLoanInfo(loanId);
            return mapLoan(loanId, info);
          }),
        ),
        loadOwnedAssetIds(readContracts, totalAssetsRaw, address),
      ]);

      setBalance(nextBalance);
      setCreditScore(nextScore);
      setLoans(nextLoans);
      setOwnedAssetIds(nextOwnedAssetIds);
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDecrypt(loanId: bigint) {
    setDecryptingId(loanId);
    setError(null);

    try {
      const { signer } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance();
      const [principalHandle, outstandingHandle, collateralHandle, thresholdHandle] =
        await contracts.privateLending.getEncryptedLoanFields(loanId);

      const [principal, outstandingBalance, collateralValue, liquidationThreshold] =
        await Promise.all([
          reencryptBalance(inst, signer, ADDRESSES.privateLending, principalHandle),
          reencryptBalance(inst, signer, ADDRESSES.privateLending, outstandingHandle),
          reencryptBalance(inst, signer, ADDRESSES.privateLending, collateralHandle),
          reencryptBalance(inst, signer, ADDRESSES.privateLending, thresholdHandle),
        ]);

      const loan = loans.find((candidate) => candidate.id === loanId);
      if (!loan) {
        return;
      }

      setDecryptedLoans((current) => ({
        ...current,
        [loanId.toString()]: {
          ...loan,
          principal,
          outstandingBalance,
          collateralValue,
          liquidationThreshold,
        },
      }));
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setDecryptingId(null);
    }
  }

  async function handleRepay(loanId: bigint) {
    const amount = repayAmounts[loanId.toString()];
    if (!amount) {
      return;
    }

    setActionLoading((current) => ({ ...current, [loanId.toString()]: true }));
    setError(null);

    try {
      const { signer, address } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance();
      const amountMicro = parseUsdToMicro(amount);
      const { handle, inputProof } = await encryptAmount(
        inst,
        ADDRESSES.privateLending,
        address,
        amountMicro,
      );

      const tx = await contracts.privateLending.repayLoan(loanId, handle, inputProof);
      await tx.wait();

      const handleToDecrypt = await contracts.privateLending.getPendingRepaymentStatusHandle(loanId);
      const repaymentStatus = await publicDecryptHandles(inst, [handleToDecrypt]);
      const finalizeTx = await contracts.privateLending.finalizeRepayment(
        loanId,
        repaymentStatus.abiEncodedClearValues,
        repaymentStatus.decryptionProof,
      );
      await finalizeTx.wait();

      setRepayAmounts((current) => ({ ...current, [loanId.toString()]: "" }));
      setDecryptedLoans({});
      await loadAccount();
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setActionLoading((current) => ({ ...current, [loanId.toString()]: false }));
    }
  }

  async function handleAccrueInterest(loanId: bigint) {
    setActionLoading((current) => ({ ...current, [`accrue-${loanId.toString()}`]: true }));
    setError(null);

    try {
      const { signer } = await getSigner();
      const contracts = getContracts(signer);
      const tx = await contracts.privateLending.accrueInterest(loanId);
      await tx.wait();
      setDecryptedLoans({});
      await loadAccount();
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setActionLoading((current) => ({ ...current, [`accrue-${loanId.toString()}`]: false }));
    }
  }

  async function handleCheckLiquidation(loanId: bigint) {
    setActionLoading((current) => ({ ...current, [`liquidate-${loanId.toString()}`]: true }));
    setError(null);

    try {
      const { signer } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance();

      const tx = await contracts.privateLending.checkAndLiquidate(loanId);
      await tx.wait();

      const handleToDecrypt = await contracts.privateLending.getPendingLiquidationDecisionHandle(loanId);
      const liquidationDecision = await publicDecryptHandles(inst, [handleToDecrypt]);
      const finalizeTx = await contracts.privateLending.finalizeLiquidation(
        loanId,
        liquidationDecision.abiEncodedClearValues,
        liquidationDecision.decryptionProof,
      );
      await finalizeTx.wait();

      setDecryptedLoans({});
      await loadAccount();
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setActionLoading((current) => ({ ...current, [`liquidate-${loanId.toString()}`]: false }));
    }
  }

  const activeLoanCount = loans.filter((loan) => loan.status === "ACTIVE").length;

  return (
    <section className="space-y-6 rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.45)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">My Account</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Wallet-level lending controls</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Your account panel decrypts only the balances, score, and loan fields you are allowed to
            access on-chain.
          </p>
        </div>
        <button
          onClick={() => loadAccount().catch(() => undefined)}
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

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="sUSD Balance" value={`${formatUsdMicro(balance)} sUSD`} />
        <MetricCard
          label="Credit Score"
          value={creditScore === null ? "Not initialized" : creditScore.toString()}
        />
        <MetricCard label="Registered Assets" value={ownedAssetIds.length.toString()} />
        <MetricCard label="Active Loans" value={activeLoanCount.toString()} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">Wallet footprint</h3>
            <p className="mt-1 text-sm text-slate-400">
              {truncateAddress(connectedAddress)} · Assets{" "}
              {ownedAssetIds.length === 0 ? "none" : ownedAssetIds.map((assetId) => `#${assetId}`).join(", ")}
            </p>
          </div>
        </div>
      </div>

      <StablecoinFaucet
        walletAddress={connectedAddress}
        balance={balance}
        onMinted={() => loadAccount()}
      />

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">My loans</h3>
          <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Borrower view</span>
        </div>

        <div className="mt-4 space-y-4">
          {loans.length === 0 ? (
            <p className="text-sm text-slate-500">
              This wallet has no live positions yet. Register collateral and request a loan from the
              protocol tab.
            </p>
          ) : (
            loans.map((loan) => {
              const loanKey = loan.id.toString();
              const privateFields = decryptedLoans[loanKey];

              return (
                <div
                  key={loanKey}
                  className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-white">
                          Loan #{loanKey} · Asset #{loan.assetId.toString()}
                        </h4>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[loan.status]}`}
                        >
                          {loan.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-400">
                        {formatDate(loan.createdAt)} · {(loan.interestRatePerYear / 100).toFixed(2)}% APR
                      </p>
                    </div>
                    <button
                      onClick={() => handleDecrypt(loan.id)}
                      disabled={decryptingId === loan.id}
                      className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 transition hover:border-white/20 hover:text-white disabled:opacity-50"
                    >
                      {decryptingId === loan.id
                        ? "Decrypting..."
                        : privateFields
                          ? "Refresh private fields"
                          : "Decrypt private fields"}
                    </button>
                  </div>

                  {privateFields && (
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <PrivateField label="Principal" value={`${formatUsdMicro(privateFields.principal)} sUSD`} />
                      <PrivateField
                        label="Outstanding"
                        value={`${formatUsdMicro(privateFields.outstandingBalance)} sUSD`}
                      />
                      <PrivateField
                        label="Collateral"
                        value={`${formatUsdMicro(privateFields.collateralValue)} sUSD`}
                      />
                      <PrivateField
                        label="Liquidation Threshold"
                        value={`${formatUsdMicro(privateFields.liquidationThreshold)} sUSD`}
                      />
                    </div>
                  )}

                  {loan.status === "ACTIVE" && (
                    <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 lg:flex-row lg:items-center">
                      <input
                        type="number"
                        value={repayAmounts[loanKey] ?? ""}
                        onChange={(event) =>
                          setRepayAmounts((current) => ({
                            ...current,
                            [loanKey]: event.target.value,
                          }))
                        }
                        min="0.01"
                        step="0.01"
                        placeholder="Repay amount"
                        className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400 lg:max-w-xs"
                      />
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          label="Repay"
                          loading={Boolean(actionLoading[loanKey])}
                          onClick={() => handleRepay(loan.id)}
                        />
                        <ActionButton
                          label="Accrue interest"
                          loading={Boolean(actionLoading[`accrue-${loanKey}`])}
                          onClick={() => handleAccrueInterest(loan.id)}
                          variant="secondary"
                        />
                        <ActionButton
                          label="Check liquidation"
                          loading={Boolean(actionLoading[`liquidate-${loanKey}`])}
                          onClick={() => handleCheckLiquidation(loan.id)}
                          variant="secondary"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

async function loadOwnedAssetIds(readContracts: ReturnType<typeof getContracts>, totalAssetsRaw: bigint, owner: string) {
  const totalAssets = Number(totalAssetsRaw);
  const assetIds = Array.from({ length: totalAssets }, (_, index) => BigInt(index));
  const owners = await Promise.all(
    assetIds.map(async (assetId) => ({
      assetId,
      owner: await readContracts.rwaRegistry.getAssetOwner(assetId),
    })),
  );

  return owners
    .filter((entry) => entry.owner.toLowerCase() === owner.toLowerCase())
    .map((entry) => entry.assetId);
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function PrivateField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function ActionButton({
  label,
  loading,
  onClick,
  variant = "primary",
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
        variant === "primary"
          ? "bg-white text-slate-950 hover:bg-slate-200"
          : "border border-white/10 text-slate-200 hover:border-white/20 hover:text-white"
      }`}
    >
      {loading ? "Working..." : label}
    </button>
  );
}
