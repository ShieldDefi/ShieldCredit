import { BrowserProvider, JsonRpcSigner, Contract } from "ethers";

// ABIs — minimal ABIs for the contracts we need
const RWA_REGISTRY_ABI = [
  "function registerAsset(bytes encryptedFaceValue, bytes inputProof, uint8 assetType, string metadataURI) external returns (uint256)",
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
  "function updateScore(address borrower, bytes encryptedDelta, bytes inputProof, bool positive) external",
];

const PRIVATE_LENDING_ABI = [
  "function requestLoan(uint256 assetId, bytes encryptedLoanAmount, bytes inputProof) external returns (uint256)",
  "function repayLoan(uint256 loanId, bytes encryptedAmount, bytes inputProof) external",
  "function checkAndLiquidate(uint256 loanId) external",
  "function accrueInterest(uint256 loanId) external",
  "function getLoanStatus(uint256 loanId) external view returns (uint8)",
  "function getBorrowerLoans(address borrower) external view returns (uint256[])",
  "function getLoanInfo(uint256 loanId) external view returns (uint256 assetId, address borrower, uint8 status, uint256 createdAt, uint256 lastAccrualAt, uint32 interestRatePerYear)",
  "function getEncryptedLoanFields(uint256 loanId) external view returns (uint256, uint256, uint256, uint256)",
  "function regulator() external view returns (address)",
  "event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 indexed assetId)",
  "event LoanRepaid(uint256 indexed loanId, address indexed borrower)",
  "event LoanLiquidated(uint256 indexed loanId, address indexed borrower)",
  "event InterestAccrued(uint256 indexed loanId, uint256 timestamp)",
];

const STABLECOIN_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function transfer(address to, bytes encryptedAmount, bytes inputProof) external",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
];

export const ADDRESSES = {
  rwaRegistry: process.env.NEXT_PUBLIC_RWA_REGISTRY_ADDRESS ?? "",
  creditScore: process.env.NEXT_PUBLIC_CREDIT_SCORE_ADDRESS ?? "",
  privateLending: process.env.NEXT_PUBLIC_PRIVATE_LENDING_ADDRESS ?? "",
  stablecoin: process.env.NEXT_PUBLIC_STABLECOIN_ADDRESS ?? "",
};

export function getContracts(signer: JsonRpcSigner) {
  return {
    rwaRegistry: new Contract(ADDRESSES.rwaRegistry, RWA_REGISTRY_ABI, signer),
    creditScore: new Contract(ADDRESSES.creditScore, CREDIT_SCORE_ABI, signer),
    privateLending: new Contract(ADDRESSES.privateLending, PRIVATE_LENDING_ABI, signer),
    stablecoin: new Contract(ADDRESSES.stablecoin, STABLECOIN_ABI, signer),
  };
}

export async function getSigner(): Promise<{
  signer: JsonRpcSigner;
  address: string;
  provider: BrowserProvider;
}> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask is not installed");
  }

  await window.ethereum.request({ method: "eth_requestAccounts" });
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();

  const network = await provider.getNetwork();
  const expectedChainId = BigInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");
  if (network.chainId !== expectedChainId) {
    throw new Error(`Please switch to the correct network (Chain ID: ${expectedChainId})`);
  }

  return { signer, address, provider };
}

// Extend Window type for ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}
