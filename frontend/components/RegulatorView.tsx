"use client";

import { useState } from "react";
import { ADDRESSES, getContracts, getSigner } from "../lib/contracts";
import { normalizeError } from "../lib/errors";
import { formatUsdMicro } from "../lib/format";
import { getOrCreateFhevmInstance, reencryptBalance } from "../lib/fhevm";
import { protocolConfig, getExplorerAddressUrl } from "../lib/protocol-config";

interface AuditReport {
  borrower: string;
  principal: bigint;
  outstandingBalance: bigint;
  liquidationThreshold: bigint;
}

export default function RegulatorView() {
  const [loanId, setLoanId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAudit(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setAuditReport(null);

    try {
      const loanIdValue = loanId.trim();
      if (!loanIdValue) {
        throw new Error("Enter the loan ID to inspect.");
      }

      const { signer, address } = await getSigner();
      const contracts = getContracts(signer);
      const liveRegulator = await contracts.privateLending.regulator();

      if (address.toLowerCase() !== liveRegulator.toLowerCase()) {
        throw new Error("Only the designated regulator wallet can decrypt compliance fields.");
      }

      const inst = await getOrCreateFhevmInstance();
      const loanIdBigInt = BigInt(loanIdValue);
      const [principalHandle, outstandingHandle, , thresholdHandle] =
        await contracts.privateLending.getEncryptedLoanFields(loanIdBigInt);
      const loanInfo = await contracts.privateLending.getLoanInfo(loanIdBigInt);

      const [principal, outstandingBalance, liquidationThreshold] = await Promise.all([
        reencryptBalance(inst, signer, ADDRESSES.privateLending, principalHandle),
        reencryptBalance(inst, signer, ADDRESSES.privateLending, outstandingHandle),
        reencryptBalance(inst, signer, ADDRESSES.privateLending, thresholdHandle),
      ]);

      setAuditReport({
        borrower: loanInfo.borrower,
        principal,
        outstandingBalance,
        liquidationThreshold,
      });
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.45)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">Compliance</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Regulator-only disclosure</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Loan principal, outstanding balance, and liquidation threshold remain encrypted until the
            designated regulator wallet decrypts them.
          </p>
        </div>
        <a
          href={getExplorerAddressUrl(protocolConfig.roles.regulator)}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-cyan-300 transition hover:text-cyan-200"
        >
          Regulator address
        </a>
      </div>

      <form onSubmit={handleAudit} className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto]">
        <input
          type="number"
          min="0"
          value={loanId}
          onChange={(event) => setLoanId(event.target.value)}
          placeholder="Loan ID"
          required
          className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
        >
          {isLoading ? "Decrypting..." : "Load compliance view"}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-rose-200">{error}</p>}

      {auditReport && (
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <AuditMetric label="Borrower" value={auditReport.borrower} mono />
          <AuditMetric label="Principal" value={`${formatUsdMicro(auditReport.principal)} sUSD`} />
          <AuditMetric
            label="Outstanding"
            value={`${formatUsdMicro(auditReport.outstandingBalance)} sUSD`}
          />
          <AuditMetric
            label="Liquidation Threshold"
            value={`${formatUsdMicro(auditReport.liquidationThreshold)} sUSD`}
          />
        </div>
      )}
    </section>
  );
}

function AuditMetric({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className={`mt-3 text-sm text-white ${mono ? "font-mono break-all" : "font-semibold"}`}>
        {value}
      </p>
    </div>
  );
}
