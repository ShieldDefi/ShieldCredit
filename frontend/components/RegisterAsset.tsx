"use client";

import { useState } from "react";
import { getSigner, getContracts } from "../lib/contracts";
import { getOrCreateFhevmInstance, encryptAmount } from "../lib/fhevm";

const ASSET_TYPES = ["TREASURY_BOND", "INVOICE", "REAL_ESTATE", "EQUITY"] as const;

export default function RegisterAsset() {
  const [assetType, setAssetType] = useState<number>(0);
  const [faceValue, setFaceValue] = useState("");
  const [metadataURI, setMetadataURI] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [registeredAssetId, setRegisteredAssetId] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setRegisteredAssetId(null);

    try {
      const { signer, address } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance();

      const faceValueMicro = BigInt(Math.round(parseFloat(faceValue) * 1_000_000));
      const { handle, inputProof } = await encryptAmount(
        inst,
        await contracts.rwaRegistry.getAddress(),
        address,
        faceValueMicro,
      );

      const tx = await contracts.rwaRegistry.registerAsset(handle, inputProof, assetType, metadataURI);
      const receipt = await tx.wait();

      const event = receipt?.logs?.find(
        (log: { fragment?: { name: string } }) => log?.fragment?.name === "AssetRegistered",
      );
      const assetId = (event as { args?: [bigint] })?.args?.[0] ?? BigInt(0);
      setRegisteredAssetId(assetId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-6">
      <h2 className="mb-2 text-xl font-bold text-white">Register RWA Asset</h2>
      <p className="mb-6 flex items-center gap-1 text-sm text-indigo-300">
        <span>🔒</span> Face value encrypted — never appears onchain in plaintext
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Asset Type</label>
          <select
            value={assetType}
            onChange={(e) => setAssetType(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {ASSET_TYPES.map((type, idx) => (
              <option key={type} value={idx}>
                {type.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Face Value (USD)</label>
          <input
            type="number"
            value={faceValue}
            onChange={(e) => setFaceValue(e.target.value)}
            placeholder="e.g. 10000"
            min="1"
            step="0.01"
            required
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Metadata URI</label>
          <input
            type="text"
            value={metadataURI}
            onChange={(e) => setMetadataURI(e.target.value)}
            placeholder="ipfs://Qm..."
            required
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-lg bg-gradient-to-r from-indigo-500 to-cyan-500 py-2.5 font-semibold text-white shadow-lg transition-all duration-200 hover:from-indigo-600 hover:to-cyan-600 disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Encrypting & Registering...
            </span>
          ) : (
            "Register Asset"
          )}
        </button>
      </form>

      {registeredAssetId !== null && (
        <div className="mt-4 rounded-lg border border-green-700 bg-green-900/30 p-4">
          <p className="font-medium text-green-300">✅ Asset Registered Successfully</p>
          <p className="mt-1 text-sm text-green-400">
            Asset ID: <span className="font-mono">{registeredAssetId.toString()}</span>
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-700 bg-red-900/30 p-4">
          <p className="text-sm text-red-300">❌ {error}</p>
        </div>
      )}
    </div>
  );
}
