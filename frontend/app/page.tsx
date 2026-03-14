"use client";

import { useState } from "react";
import ConnectWallet from "../components/ConnectWallet";
import RegisterAsset from "../components/RegisterAsset";
import RequestLoan from "../components/RequestLoan";
import LoanDashboard from "../components/LoanDashboard";
import RegulatorView from "../components/RegulatorView";

type Tab = "register" | "request" | "loans" | "regulator";

const TABS: { id: Tab; label: string }[] = [
  { id: "register", label: "Register Asset" },
  { id: "request", label: "Request Loan" },
  { id: "loans", label: "My Loans" },
  { id: "regulator", label: "Regulator" },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>("register");
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-indigo-950 to-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-sm font-bold">
              SC
            </div>
            <div>
              <h1 className="font-bold text-lg leading-none">ShieldCredit</h1>
              <p className="text-xs text-gray-400 leading-none mt-0.5">Confidential RWA-Backed Lending · Powered by Zama fhEVM</p>
            </div>
          </div>
          <ConnectWallet
            onConnect={(addr) => setConnectedAddress(addr)}
            onDisconnect={() => setConnectedAddress(null)}
          />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {!connectedAddress ? (
          /* Hero section */
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
            <div className="mb-6 w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-2xl shadow-2xl shadow-indigo-500/30">
              🔒
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold mb-4 bg-gradient-to-r from-indigo-300 to-cyan-300 bg-clip-text text-transparent">
              Private Lending for Real-World Assets
            </h2>
            <p className="text-lg text-gray-400 max-w-2xl mb-8 leading-relaxed">
              ShieldCredit enables institutions to collateralize real-world assets — bonds, invoices, real estate — and borrow stablecoins with fully encrypted loan terms. Powered by Zama&apos;s fhEVM, your financial data stays private on-chain.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10 w-full max-w-2xl text-sm">
              {[
                { icon: "🔐", title: "Encrypted Balances", desc: "Face values and loan amounts never appear in plaintext" },
                { icon: "🏦", title: "RWA Collateral", desc: "Treasury bonds, invoices, real estate, equity" },
                { icon: "🎯", title: "Selective Disclosure", desc: "Only you and your regulator can decrypt loan details" },
              ].map((feature) => (
                <div key={feature.title} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-left">
                  <div className="text-2xl mb-2">{feature.icon}</div>
                  <div className="font-semibold text-white mb-1">{feature.title}</div>
                  <div className="text-gray-400 text-xs">{feature.desc}</div>
                </div>
              ))}
            </div>
            <p className="text-gray-500 text-sm">Connect your wallet to start →</p>
          </div>
        ) : (
          /* App section */
          <div>
            {/* Tab navigation */}
            <div className="flex gap-1 mb-8 bg-gray-900/50 p-1 rounded-xl border border-gray-800 w-fit">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? "bg-gradient-to-r from-indigo-500 to-cyan-500 text-white shadow-lg"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex justify-center">
              {activeTab === "register" && <RegisterAsset />}
              {activeTab === "request" && <RequestLoan />}
              {activeTab === "loans" && <LoanDashboard />}
              {activeTab === "regulator" && <RegulatorView />}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
