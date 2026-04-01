"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { getSigner } from "../lib/contracts";
import { getOrCreateFhevmInstance, resetFhevmInstance } from "../lib/fhevm";

interface ConnectWalletProps {
  onConnect?: (address: string) => void;
  onDisconnect?: () => void;
}

export default function ConnectWallet({ onConnect, onDisconnect }: ConnectWalletProps) {
  const { address, connector, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const initializeWallet = async () => {
      if (!isConnected || !address) {
        resetFhevmInstance();
        setError(null);
        onDisconnect?.();
        return;
      }

      setIsPreparing(true);
      setError(null);
      try {
        const connectorProvider = await connector?.getProvider?.();
        resetFhevmInstance();
        const { provider } = await getSigner(connectorProvider);
        await getOrCreateFhevmInstance(connectorProvider);
        if (!cancelled) {
          onConnect?.(address);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to initialize wallet");
        }
      } finally {
        if (!cancelled) {
          setIsPreparing(false);
        }
      }
    };

    initializeWallet().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [address, connector, isConnected, onConnect, onDisconnect]);

  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        const ready = mounted;
        const connected = ready && !!account && !!chain;

        return (
          <div
            className="flex flex-col items-end gap-1"
            aria-hidden={!ready}
            style={{
              opacity: ready ? 1 : 0,
              pointerEvents: ready ? "auto" : "none",
              userSelect: ready ? "auto" : "none",
            }}
          >
            {!connected ? (
              <button
                onClick={openConnectModal}
                disabled={isPreparing}
                className="rounded-lg bg-gradient-to-r from-indigo-500 to-cyan-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all duration-200 hover:from-indigo-600 hover:to-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPreparing ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Connecting...
                  </span>
                ) : (
                  "Connect Wallet"
                )}
              </button>
            ) : chain.unsupported ? (
              <button
                onClick={openChainModal}
                className="rounded-lg border border-red-700 bg-red-900/40 px-4 py-2 text-sm font-semibold text-red-200 transition-colors hover:bg-red-900/60"
              >
                Wrong network
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={openAccountModal}
                  className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2"
                >
                  <div className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                  <span className="font-mono text-sm text-gray-200">
                    {truncateAddress(account.address)}
                  </span>
                  <span className="ml-1 text-xs text-gray-500">{chain.name}</span>
                </button>
                <button
                  onClick={() => {
                    resetFhevmInstance();
                    disconnect();
                    onDisconnect?.();
                  }}
                  className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 transition-colors hover:border-red-800 hover:text-red-400"
                >
                  Disconnect
                </button>
              </div>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
