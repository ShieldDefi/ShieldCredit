"use client";

import { useState } from "react";
import { getContracts, getSigner } from "../lib/contracts";
import { normalizeError } from "../lib/errors";
import { parseUsdToMicro } from "../lib/format";
import { encryptAmount, getOrCreateFhevmInstance } from "../lib/fhevm";

const ASSET_TYPES = ["Treasury Bond", "Invoice", "Real Estate", "Equity"] as const;

interface RegisterAssetProps {
  onSuccess?: () => void;
}

export default function RegisterAsset({ onSuccess }: RegisterAssetProps) {
  const [assetType, setAssetType] = useState(0);
  const [faceValue, setFaceValue] = useState("");
  const [metadataURI, setMetadataURI] = useState("");
  const [registeredAssetId, setRegisteredAssetId] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setRegisteredAssetId(null);

    try {
      if (!metadataURI.trim()) {
        throw new Error("Enter a metadata URI for this collateral.");
      }

      const { signer, address } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance();
      const faceValueMicro = parseUsdToMicro(faceValue);
      const registryAddress = await contracts.rwaRegistry.getAddress();

      const { handle, inputProof } = await encryptAmount(inst, registryAddress, address, faceValueMicro);
      const tx = await contracts.rwaRegistry.registerAsset(handle, inputProof, assetType, metadataURI.trim());
      const receipt = await tx.wait();
      const eventLog = receipt?.logs.find(
        (log: { fragment?: { name?: string } }) => log.fragment?.name === "AssetRegistered",
      );

      setRegisteredAssetId((eventLog as { args?: [bigint] })?.args?.[0] ?? null);
      onSuccess?.();
    } catch (nextError: unknown) {
      setError(normalizeError(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
      <h3 className="text-lg font-semibold text-white">Register collateral</h3>
      <p className="mt-2 text-sm text-slate-400">
        Submit a live RWA position to the registry. The face value is encrypted before it reaches the
        contract.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label className="mb-2 block text-sm text-slate-300">Asset type</label>
          <select
            value={assetType}
            onChange={(event) => setAssetType(Number(event.target.value))}
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
          >
            {ASSET_TYPES.map((type, index) => (
              <option key={type} value={index}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">Face value (USD)</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={faceValue}
            onChange={(event) => setFaceValue(event.target.value)}
            placeholder="250000"
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">Metadata URI</label>
          <input
            type="text"
            value={metadataURI}
            onChange={(event) => setMetadataURI(event.target.value)}
            placeholder="ipfs://shieldcredit/example.json"
            required
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
        >
          {isLoading ? "Registering..." : "Register asset"}
        </button>
      </form>

      {registeredAssetId !== null && (
        <p className="mt-4 text-sm text-emerald-200">Collateral registered as asset #{registeredAssetId.toString()}.</p>
      )}

      {error && <p className="mt-4 text-sm text-rose-200">{error}</p>}
    </section>
  );
}
