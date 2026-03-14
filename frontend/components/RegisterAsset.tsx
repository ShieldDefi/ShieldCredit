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
      const { signer, address, provider } = await getSigner();
      const contracts = getContracts(signer);
      const inst = await getOrCreateFhevmInstance(provider);

      const faceValueMicro = BigInt(Math.round(parseFloat(faceValue) * 1_000_000));
      const { handles, inputProof } = await encryptAmount(
        inst,
        await contracts.rwaRegistry.getAddress(),
        address,
        faceValueMicro
      );

      const tx = await contracts.rwaRegistry.registerAsset(
        handles[0],
        inputProof,
        assetType,
        metadataURI
      );
      const receipt = await tx.wait();

      const event = receipt?.logs?.find(
        (log: { fragment?: { name: string } }) => log?.fragment?.name === "AssetRegistered"
      );
      const assetId: bigint = (event as { args?: [bigint] })?.args?.[0] ?? 0n;
      setRegisteredAssetId(assetId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-lg w-full">
      <h2 className="text-xl font-bold text-white mb-2">Register RWA Asset</h2>
      <p className="text-sm text-indigo-300 mb-6 flex items-center gap-1">
        <span>🔒</span> Face value encrypted — never appears onchain in plaintext
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Asset Type</label>
          <select
            value={assetType}
            onChange={(e) => setAssetType(Number(e.target.value))}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {ASSET_TYPES.map((type, idx) => (
              <option key={type} value={idx}>
                {type.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Face Value (USD)</label>
          <input
            type="number"
            value={faceValue}
            onChange={(e) => setFaceValue(e.target.value)}
            placeholder="e.g. 10000"
            min="1"
            step="0.01"
            required
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Metadata URI</label>
          <input
            type="text"
            value={metadataURI}
            onChange={(e) => setMetadataURI(e.target.value)}
            placeholder="ipfs://Qm..."
            required
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-all duration-200 shadow-lg"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
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
        <div className="mt-4 p-4 bg-green-900/30 border border-green-700 rounded-lg">
          <p className="text-green-300 font-medium">✅ Asset Registered Successfully</p>
          <p className="text-sm text-green-400 mt-1">Asset ID: <span className="font-mono">{registeredAssetId.toString()}</span></p>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-900/30 border border-red-700 rounded-lg">
          <p className="text-red-300 text-sm">❌ {error}</p>
        </div>
      )}
    </div>
  );
}
