"use client";

import { useState } from "react";
import BrandMark from "../components/BrandMark";
import ConnectWallet from "../components/ConnectWallet";
import RegisterAsset from "../components/RegisterAsset";
import RequestLoan from "../components/RequestLoan";
import LoanDashboard from "../components/LoanDashboard";
import RegulatorView from "../components/RegulatorView";
import StablecoinFaucet from "../components/StablecoinFaucet";

type Tab = "dashboard" | "register" | "request" | "faucet" | "regulator";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "register", label: "Register Asset" },
  { id: "request", label: "Request Loan" },
  { id: "faucet", label: "Faucet" },
  { id: "regulator", label: "Regulator" },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-indigo-950 to-gray-950 text-white">
      <header className="sticky top-0 z-10 border-b border-gray-800/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <BrandMark size={36} className="h-9 w-9" />
            <div>
              <h1 className="text-lg font-bold leading-none">ShieldCredit</h1>
              <p className="mt-0.5 text-xs leading-none text-gray-400">
                Confidential RWA-Backed Lending · Powered by Zama fhEVM
              </p>
            </div>
          </div>
          <ConnectWallet
            onConnect={(addr) => setConnectedAddress(addr)}
            onDisconnect={() => setConnectedAddress(null)}
          />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        {!connectedAddress ? (
          <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
            <div className="mb-6 rounded-[28px] border border-cyan-400/10 bg-gray-900/70 p-3 shadow-2xl shadow-cyan-500/10">
              <BrandMark size={64} className="h-16 w-16" />
            </div>
            <h2 className="mb-4 bg-gradient-to-r from-indigo-300 to-cyan-300 bg-clip-text text-4xl font-extrabold text-transparent md:text-5xl">
              Private Lending for Real-World Assets
            </h2>
            <p className="mb-8 max-w-2xl text-lg leading-relaxed text-gray-400">
              ShieldCredit enables institutions to collateralize real-world assets — bonds, invoices, real estate — and
              borrow stablecoins with fully encrypted loan terms. Powered by Zama&apos;s fhEVM, your financial data stays
              private on-chain.
            </p>
            <div className="mb-10 grid w-full max-w-2xl grid-cols-1 gap-4 text-sm md:grid-cols-3">
              {[
                { icon: "🔐", title: "Encrypted Balances", desc: "Face values and loan amounts never appear in plaintext" },
                { icon: "🏦", title: "RWA Collateral", desc: "Treasury bonds, invoices, real estate, equity" },
                { icon: "🎯", title: "Selective Disclosure", desc: "Only you and your regulator can decrypt loan details" },
              ].map((feature) => (
                <div key={feature.title} className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 text-left">
                  <div className="mb-2 text-2xl">{feature.icon}</div>
                  <div className="mb-1 font-semibold text-white">{feature.title}</div>
                  <div className="text-xs text-gray-400">{feature.desc}</div>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-500">Connect your wallet to start →</p>
          </div>
        ) : (
          <div>
            <div className="mb-8 flex w-fit gap-1 rounded-xl border border-gray-800 bg-gray-900/50 p-1">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? "bg-gradient-to-r from-indigo-500 to-cyan-500 text-white shadow-lg"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex justify-center">
              {activeTab === "dashboard" && <LoanDashboard />}
              {activeTab === "register" && <RegisterAsset />}
              {activeTab === "request" && <RequestLoan />}
              {activeTab === "faucet" && <StablecoinFaucet />}
              {activeTab === "regulator" && <RegulatorView />}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
