import { BrowserProvider, Contract, JsonRpcSigner, JsonRpcProvider } from "ethers";
import { getActiveWalletProvider, targetChain } from "./wagmi";

// ABIs — minimal ABIs for the contracts we need
const RWA_REGISTRY_ABI = [
  "function registerAsset(bytes32 encryptedFaceValue, bytes inputProof, uint8 assetType, string metadataURI) external returns (uint256)",
  "function transferAsset(uint256 assetId, address newOwner) external",
  "function lockAsset(uint256 assetId, address lendingContract) external",
  "function unlockAsset(uint256 assetId) external",
  "function getFaceValue(uint256 assetId) external view returns (uint256)",
  "function getAssetOwner(uint256 assetId) external view returns (address)",
  "function isLocked(uint256 assetId) external view returns (bool)",
  "function getAsset(uint256 assetId) external view returns (uint8, address, bool, address, string, uint256)",
  "function totalAssets() external view returns (uint256)",
  "function issuerAssets(address, uint256) external view returns (uint256)",
  "event AssetRegistered(uint256 indexed assetId, address indexed owner, uint8 assetType)",
];

const CREDIT_SCORE_ABI = [
  "function initialized(address) external view returns (bool)",
  "function getEncryptedScore(address borrower) external view returns (uint256)",
  "function isEligible(address borrower, uint32 minimum) external returns (uint256)",
  "function initializeScore(address borrower) external",
  "function updateScore(address borrower, bytes32 encryptedDelta, bytes inputProof, bool positive) external",
];

const PRIVATE_LENDING_ABI = [
  "function requestLoan(uint256 assetId, bytes32 encryptedLoanAmount, bytes inputProof) external returns (uint256)",
  "function repayLoan(uint256 loanId, bytes32 encryptedAmount, bytes inputProof) external",
  "function finalizeRepayment(uint256 loanId, bytes abiEncodedCleartexts, bytes decryptionProof) external",
  "function checkAndLiquidate(uint256 loanId) external",
  "function finalizeLiquidation(uint256 loanId, bytes abiEncodedCleartexts, bytes decryptionProof) external",
  "function accrueInterest(uint256 loanId) external",
  "function totalLoans() external view returns (uint256)",
  "function getLoanStatus(uint256 loanId) external view returns (uint8)",
  "function getBorrowerLoans(address borrower) external view returns (uint256[])",
  "function getLoanInfo(uint256 loanId) external view returns (uint256 assetId, address borrower, uint8 status, uint256 createdAt, uint256 lastAccrualAt, uint32 interestRatePerYear)",
  "function getEncryptedLoanFields(uint256 loanId) external view returns (uint256, uint256, uint256, uint256)",
  "function getPendingRepaymentStatusHandle(uint256 loanId) external view returns (bytes32)",
  "function getPendingLiquidationDecisionHandle(uint256 loanId) external view returns (bytes32)",
  "function regulator() external view returns (address)",
  "event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 indexed assetId)",
  "event LoanRepaid(uint256 indexed loanId, address indexed borrower)",
  "event LoanLiquidated(uint256 indexed loanId, address indexed borrower)",
  "event InterestAccrued(uint256 indexed loanId, uint256 timestamp)",
];

const STABLECOIN_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function transfer(address to, bytes32 encryptedAmount, bytes inputProof) external",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
];

const STABLECOIN_FAUCET_ABI = [
  "function mint(address recipient, bytes32 encryptedAmount, bytes inputProof) external",
  "function mintToSelf(bytes32 encryptedAmount, bytes inputProof) external",
];

export const ADDRESSES = {
  rwaRegistry: process.env.NEXT_PUBLIC_RWA_REGISTRY_ADDRESS ?? "",
  creditScore: process.env.NEXT_PUBLIC_CREDIT_SCORE_ADDRESS ?? "",
  privateLending: process.env.NEXT_PUBLIC_PRIVATE_LENDING_ADDRESS ?? "",
  stablecoin: process.env.NEXT_PUBLIC_STABLECOIN_ADDRESS ?? "",
  stablecoinFaucet: process.env.NEXT_PUBLIC_STABLECOIN_FAUCET_ADDRESS ?? "",
};

export function getContracts(signerOrProvider: JsonRpcSigner | BrowserProvider | JsonRpcProvider) {
  return {
    rwaRegistry: new Contract(ADDRESSES.rwaRegistry, RWA_REGISTRY_ABI, signerOrProvider),
    creditScore: new Contract(ADDRESSES.creditScore, CREDIT_SCORE_ABI, signerOrProvider),
    privateLending: new Contract(ADDRESSES.privateLending, PRIVATE_LENDING_ABI, signerOrProvider),
    stablecoin: new Contract(ADDRESSES.stablecoin, STABLECOIN_ABI, signerOrProvider),
    stablecoinFaucet: new Contract(ADDRESSES.stablecoinFaucet, STABLECOIN_FAUCET_ABI, signerOrProvider),
  };
}

export function getReadProvider() {
  if (process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL) {
    return new JsonRpcProvider(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL);
  }

  if (typeof window !== "undefined" && window.ethereum) {
    return new BrowserProvider(window.ethereum);
  }

  throw new Error("Missing NEXT_PUBLIC_SEPOLIA_RPC_URL for public protocol reads.");
}

export async function getBrowserProvider(providerLike?: any): Promise<BrowserProvider> {
  if (providerLike instanceof BrowserProvider) {
    return providerLike;
  }

  const resolvedProvider = providerLike ?? await getActiveWalletProvider();

  if (typeof window === "undefined" || !resolvedProvider) {
    throw new Error("No injected wallet found. Install a supported wallet and reconnect.");
  }

  return new BrowserProvider(resolvedProvider);
}

export async function assertExpectedNetwork(provider: BrowserProvider) {
  const network = await provider.getNetwork();
  const expectedChainId = BigInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");

  if (network.chainId !== expectedChainId) {
    throw new Error(
      `Please switch your wallet to ${targetChain.name} (chain ID ${expectedChainId.toString()}).`,
    );
  }

  return network;
}

export async function getSigner(providerLike?: any): Promise<{
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
  return Object.values(ADDRESSES).every(Boolean);
}

declare global {
  interface Window {
    ethereum?: any;
  }
}
