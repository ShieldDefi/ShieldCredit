import { BrowserProvider, Contract, JsonRpcProvider, JsonRpcSigner, isAddress } from "ethers";
import { protocolConfig } from "./protocol-config";
import { getActiveWalletProvider, targetChain } from "./wagmi";

const RWA_REGISTRY_ABI = [
  "function registerAsset(bytes32 encryptedFaceValue, bytes inputProof, uint8 assetType, string metadataURI) external returns (uint256 assetId)",
  "function getFaceValue(uint256 assetId) external view returns (uint256 faceValue)",
  "function getAssetOwner(uint256 assetId) external view returns (address owner)",
  "function isLocked(uint256 assetId) external view returns (bool locked)",
  "function getAsset(uint256 assetId) external view returns (uint8 assetType, address assetOwner, bool locked, address lockedBy, string metadataURI, uint256 registeredAt)",
  "function totalAssets() external view returns (uint256 total)",
  "event AssetRegistered(uint256 indexed assetId, address indexed owner, uint8 assetType)",
] as const;

const CREDIT_SCORE_ABI = [
  "function initialized(address) external view returns (bool initialized)",
  "function getEncryptedScore(address borrower) external view returns (uint256 scoreHandle)",
] as const;

const PRIVATE_LENDING_ABI = [
  "function requestLoan(uint256 assetId, bytes32 encryptedLoanAmount, bytes inputProof) external returns (uint256 loanId)",
  "function repayLoan(uint256 loanId, bytes32 encryptedAmount, bytes inputProof) external",
  "function finalizeRepayment(uint256 loanId, bytes abiEncodedCleartexts, bytes decryptionProof) external",
  "function checkAndLiquidate(uint256 loanId) external",
  "function finalizeLiquidation(uint256 loanId, bytes abiEncodedCleartexts, bytes decryptionProof) external",
  "function accrueInterest(uint256 loanId) external",
  "function totalLoans() external view returns (uint256 total)",
  "function getLoanStatus(uint256 loanId) external view returns (uint8 status)",
  "function getBorrowerLoans(address borrower) external view returns (uint256[] loanIds)",
  "function getLoanInfo(uint256 loanId) external view returns (uint256 assetId, address borrower, uint8 status, uint256 createdAt, uint256 lastAccrualAt, uint32 interestRatePerYear)",
  "function getEncryptedLoanFields(uint256 loanId) external view returns (uint256 principal, uint256 outstandingBalance, uint256 collateralValue, uint256 liquidationThreshold)",
  "function getPendingRepaymentStatusHandle(uint256 loanId) external view returns (bytes32 handle)",
  "function getPendingLiquidationDecisionHandle(uint256 loanId) external view returns (bytes32 handle)",
  "function regulator() external view returns (address regulatorAddress)",
  "event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 indexed assetId)",
  "event LoanRepaid(uint256 indexed loanId, address indexed borrower)",
  "event LoanLiquidated(uint256 indexed loanId, address indexed borrower)",
  "event InterestAccrued(uint256 indexed loanId, uint256 timestamp)",
] as const;

const STABLECOIN_ABI = [
  "function balanceOf(address account) external view returns (uint256 balanceHandle)",
  "function totalSupply() external view returns (uint256 totalSupplyHandle)",
  "function transfer(address to, bytes32 encryptedAmount, bytes inputProof) external",
  "function name() external view returns (string tokenName)",
  "function symbol() external view returns (string tokenSymbol)",
  "function decimals() external view returns (uint8 tokenDecimals)",
] as const;

const STABLECOIN_FAUCET_ABI = [
  "function mint(address recipient, bytes32 encryptedAmount, bytes inputProof) external",
  "function mintToSelf(bytes32 encryptedAmount, bytes inputProof) external",
] as const;

export const ADDRESSES = protocolConfig.contracts;

function assertConfiguredAddress(label: string, address: string) {
  if (!isAddress(address)) {
    throw new Error(`ShieldCredit ${label} address is unavailable in this build.`);
  }
}

function assertDeploymentAddresses() {
  assertConfiguredAddress("RWA Registry", ADDRESSES.rwaRegistry);
  assertConfiguredAddress("Credit Score", ADDRESSES.creditScore);
  assertConfiguredAddress("Private Lending", ADDRESSES.privateLending);
  assertConfiguredAddress("Stablecoin", ADDRESSES.stablecoin);
  assertConfiguredAddress("Stablecoin Faucet", ADDRESSES.stablecoinFaucet);
}

export function getContracts(signerOrProvider: JsonRpcSigner | BrowserProvider | JsonRpcProvider) {
  assertDeploymentAddresses();

  return {
    rwaRegistry: new Contract(ADDRESSES.rwaRegistry, RWA_REGISTRY_ABI, signerOrProvider),
    creditScore: new Contract(ADDRESSES.creditScore, CREDIT_SCORE_ABI, signerOrProvider),
    privateLending: new Contract(ADDRESSES.privateLending, PRIVATE_LENDING_ABI, signerOrProvider),
    stablecoin: new Contract(ADDRESSES.stablecoin, STABLECOIN_ABI, signerOrProvider),
    stablecoinFaucet: new Contract(ADDRESSES.stablecoinFaucet, STABLECOIN_FAUCET_ABI, signerOrProvider),
  };
}

let readProvider: JsonRpcProvider | null = null;

export function getReadProvider() {
  if (!readProvider) {
    readProvider = new JsonRpcProvider(protocolConfig.rpcUrl);
  }

  return readProvider;
}

export async function getBrowserProvider(providerLike?: unknown): Promise<BrowserProvider> {
  if (providerLike instanceof BrowserProvider) {
    return providerLike;
  }

  const resolvedProvider = providerLike ?? await getActiveWalletProvider();

  if (typeof window === "undefined" || !resolvedProvider) {
    throw new Error("No injected wallet found. Install a supported wallet and reconnect.");
  }

  return new BrowserProvider(resolvedProvider as any);
}

export async function assertExpectedNetwork(provider: BrowserProvider) {
  const network = await provider.getNetwork();
  const expectedChainId = BigInt(protocolConfig.chainId);

  if (network.chainId !== expectedChainId) {
    throw new Error(
      `Please switch your wallet to ${targetChain.name} (chain ID ${expectedChainId.toString()}).`,
    );
  }

  return network;
}

export async function getSigner(providerLike?: unknown): Promise<{
  signer: JsonRpcSigner;
  address: string;
  provider: BrowserProvider;
}> {
  const provider = await getBrowserProvider(providerLike);
  await assertExpectedNetwork(provider);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  return { signer, address, provider };
}

export function hasDeploymentAddresses() {
  return Object.values(ADDRESSES).every((value) => isAddress(value));
}

declare global {
  interface Window {
    ethereum?: unknown;
  }
}
