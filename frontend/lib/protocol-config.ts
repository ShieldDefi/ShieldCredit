import { sepolia } from "wagmi/chains";

const deployedContracts = {
  rwaRegistry: "0xbc267A4eBa92B4E2d726DD98b533F80837017959",
  creditScore: "0x7658f88067A1a8dAf1F1c0490fB128FaFf3177C4",
  privateLending: "0x1f8365aC24FC5210656664CAb2d078aCF1B9fA96",
  stablecoin: "0xa5765B5161d1D913407376a975DBF63Eb74e2365",
  stablecoinFaucet: "0xC063D7f02E86c7E71747449987C454B2c86190d1",
} as const;

const protocolRoles = {
  deployer: "0x9f2EdCE3a34e42eaf8f965d4E14aDDd12Cf865f4",
  auditor: "0x9f2EdCE3a34e42eaf8f965d4E14aDDd12Cf865f4",
  oracle: "0x9f2EdCE3a34e42eaf8f965d4E14aDDd12Cf865f4",
  regulator: "0x9f2EdCE3a34e42eaf8f965d4E14aDDd12Cf865f4",
} as const;

function readEnv(name: string) {
  const value = process.env[name];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumericEnv(name: string, fallback: number) {
  const value = readEnv(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const protocolConfig = {
  appName: "ShieldCredit",
  chain: sepolia,
  chainId: readNumericEnv("NEXT_PUBLIC_CHAIN_ID", sepolia.id),
  rpcUrl: readEnv("NEXT_PUBLIC_SEPOLIA_RPC_URL") ?? sepolia.rpcUrls.default.http[0],
  explorerBaseUrl: "https://sepolia.etherscan.io",
  relayerApiKey: readEnv("NEXT_PUBLIC_ZAMA_RELAYER_API_KEY") ?? "",
  contracts: {
    rwaRegistry: readEnv("NEXT_PUBLIC_RWA_REGISTRY_ADDRESS") ?? deployedContracts.rwaRegistry,
    creditScore: readEnv("NEXT_PUBLIC_CREDIT_SCORE_ADDRESS") ?? deployedContracts.creditScore,
    privateLending:
      readEnv("NEXT_PUBLIC_PRIVATE_LENDING_ADDRESS") ?? deployedContracts.privateLending,
    stablecoin: readEnv("NEXT_PUBLIC_STABLECOIN_ADDRESS") ?? deployedContracts.stablecoin,
    stablecoinFaucet: readEnv("NEXT_PUBLIC_STABLECOIN_FAUCET_ADDRESS")
      ?? deployedContracts.stablecoinFaucet,
  },
  roles: protocolRoles,
} as const;

export function getExplorerAddressUrl(address: string) {
  return `${protocolConfig.explorerBaseUrl}/address/${address}`;
}

export function getExplorerTransactionUrl(hash: string) {
  return `${protocolConfig.explorerBaseUrl}/tx/${hash}`;
}
