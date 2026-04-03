import { getAccount, injected } from "@wagmi/core";
import { createConfig, http } from "wagmi";
import { protocolConfig } from "./protocol-config";

export const targetChain = protocolConfig.chain;

export const wagmiConfig = createConfig({
  chains: [targetChain],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    [targetChain.id]: http(protocolConfig.rpcUrl),
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
