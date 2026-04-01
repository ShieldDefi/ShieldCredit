import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { getAccount } from "@wagmi/core";
import { http } from "wagmi";
import { sepolia } from "wagmi/chains";

export const targetChain = sepolia;

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "shieldcredit-local-dev";

const rpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || targetChain.rpcUrls.default.http[0];

const wallets = [
  {
    groupName: "Recommended",
    wallets: [injectedWallet, walletConnectWallet, coinbaseWallet],
  },
];

export const wagmiConfig = getDefaultConfig({
  appName: "ShieldCredit",
  projectId: walletConnectProjectId,
  chains: [targetChain],
  wallets,
  transports: {
    [targetChain.id]: http(rpcUrl),
  },
  ssr: true,
});

export async function getActiveWalletProvider() {
  const account = getAccount(wagmiConfig);

  if (account.status !== "connected" || !account.connector) {
    throw new Error("Connect a wallet first.");
  }

  const provider = await account.connector.getProvider({ chainId: targetChain.id });

  if (!provider) {
    throw new Error("Connected wallet provider is unavailable.");
  }

  return provider;
}
