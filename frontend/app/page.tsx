"use client";

import { useState } from "react";
import AccountPanel from "../components/AccountPanel";
import BrandMark from "../components/BrandMark";
import ConnectWallet from "../components/ConnectWallet";
import LoanDashboard from "../components/LoanDashboard";
import RegulatorView from "../components/RegulatorView";
import RegisterAsset from "../components/RegisterAsset";
import RequestLoan from "../components/RequestLoan";

type Tab = "protocol" | "account" | "compliance";

const tabs: { id: Tab; label: string }[] = [
  { id: "protocol", label: "Protocol" },
  { id: "account", label: "Account" },
  { id: "compliance", label: "Compliance" },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>("protocol");
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const triggerRefresh = () => setRefreshVersion((value) => value + 1);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b_0%,#0f172a_38%,#020617_100%)] text-white">
      <header className="border-b border-white/10 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <BrandMark size={40} className="h-10 w-10" />
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">ShieldCredit</p>
              <h1 className="mt-1 text-xl font-semibold text-white">
                Confidential RWA-backed lending on Sepolia
              </h1>
            </div>
          </div>
          <ConnectWallet
            onConnect={(address) => setConnectedAddress(address)}
            onDisconnect={() => setConnectedAddress(null)}
          />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        {!connectedAddress ? (
          <div className="space-y-8">
            <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.45)]">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-white/5">
                <BrandMark size={36} className="h-9 w-9" />
              </div>
              <h2 className="mt-6 text-4xl font-semibold text-white">Live confidential credit, no mock data</h2>
              <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-slate-400">
                View the seeded Sepolia protocol state now, then connect a wallet to register
                collateral, request loans, mint sUSD from the deployed faucet, and decrypt your own
                positions.
              </p>
            </section>

            <LoanDashboard refreshVersion={refreshVersion} />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-slate-950/60 p-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                    activeTab === tab.id
                      ? "bg-white text-slate-950"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === "protocol" && (
              <div className="space-y-6">
                <LoanDashboard refreshVersion={refreshVersion} />
                <div className="grid gap-6 xl:grid-cols-2">
                  <RegisterAsset onSuccess={triggerRefresh} />
                  <RequestLoan onSuccess={triggerRefresh} />
                </div>
              </div>
            )}

            {activeTab === "account" && (
              <AccountPanel connectedAddress={connectedAddress} refreshVersion={refreshVersion} />
            )}

            {activeTab === "compliance" && <RegulatorView />}
          </div>
        )}
      </main>
    </div>
  );
}
