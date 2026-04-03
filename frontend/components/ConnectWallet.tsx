"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { getSigner } from "../lib/contracts";
import { normalizeError } from "../lib/errors";
import { resetFhevmInstance, getOrCreateFhevmInstance } from "../lib/fhevm";
import { targetChain } from "../lib/wagmi";

interface ConnectWalletProps {
  onConnect?: (address: string) => void;
  onDisconnect?: () => void;
}

export default function ConnectWallet({ onConnect, onDisconnect }: ConnectWalletProps) {
  const { address, chainId, connector, isConnected } = useAccount();
  const { connect, connectors, error: connectError, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primaryConnector = useMemo(() => connectors[0] ?? null, [connectors]);
  const isWrongNetwork = isConnected && chainId !== targetChain.id;

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
        await getSigner(connectorProvider);
        await getOrCreateFhevmInstance(connectorProvider);

        if (!cancelled) {
          onConnect?.(address);
        }
      } catch (nextError: unknown) {
        if (!cancelled) {
          setError(normalizeError(nextError));
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

  useEffect(() => {
    if (connectError) {
      setError(normalizeError(connectError));
    }
  }, [connectError]);

  const truncatedAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Wallet";

  if (!isConnected) {
    return (
      <div className="flex flex-col items-end gap-2">
        <button
          onClick={() => {
            if (primaryConnector) {
              connect({ connector: primaryConnector });
            }
          }}
          disabled={!primaryConnector || isConnecting || isPreparing}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isConnecting || isPreparing ? "Connecting..." : "Connect Wallet"}
        </button>
        {error && <p className="max-w-xs text-right text-xs text-rose-300">{error}</p>}
      </div>
    );
  }

  if (isWrongNetwork) {
    return (
      <div className="flex flex-col items-end gap-2">
        <button
          onClick={() => switchChain({ chainId: targetChain.id })}
          disabled={isSwitching}
          className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:opacity-50"
        >
          {isSwitching ? "Switching..." : `Switch to ${targetChain.name}`}
        </button>
        {error && <p className="max-w-xs text-right text-xs text-rose-300">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-2">
        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Wallet</div>
        <div className="mt-1 font-mono text-sm text-white">{truncatedAddress}</div>
      </div>
      <button
        onClick={() => {
          resetFhevmInstance();
          disconnect();
          onDisconnect?.();
        }}
        className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:border-white/20 hover:text-white"
      >
        Disconnect
      </button>
      {error && <p className="max-w-xs text-right text-xs text-rose-300">{error}</p>}
    </div>
  );
}
