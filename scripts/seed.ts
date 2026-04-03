import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers, hexlify, zeroPadValue } from "ethers";
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node";

dotenv.config();

const RWA_REGISTRY_ABI = [
  "function totalAssets() view returns (uint256)",
  "function registerAsset(bytes32 encryptedFaceValue, bytes inputProof, uint8 assetType, string metadataURI) external returns (uint256)",
];

const PRIVATE_LENDING_ABI = [
  "function requestLoan(uint256 assetId, bytes32 encryptedLoanAmount, bytes inputProof) external returns (uint256)",
  "function getBorrowerLoans(address borrower) external view returns (uint256[])",
  "function getLoanInfo(uint256 loanId) external view returns (uint256 assetId, address borrower, uint8 status, uint256 createdAt, uint256 lastAccrualAt, uint32 interestRatePerYear)",
];

type DeploymentFile = {
  contracts: {
    RWARegistry: string;
    PrivateLending: string;
  };
};

const SEED_ASSETS = [
  {
    assetType: 0,
    faceValue: 1_250_000_000_000n,
    metadataURI: "ipfs://shieldcredit/us-treasury-note-2028.json",
    requestedLoanAmount: 700_000_000_000n,
  },
  {
    assetType: 1,
    faceValue: 420_000_000_000n,
    metadataURI: "ipfs://shieldcredit/enterprise-invoice-batch-a17.json",
    requestedLoanAmount: 210_000_000_000n,
  },
  {
    assetType: 2,
    faceValue: 2_100_000_000_000n,
    metadataURI: "ipfs://shieldcredit/lagos-logistics-warehouse.json",
    requestedLoanAmount: 1_100_000_000_000n,
  },
  {
    assetType: 3,
    faceValue: 890_000_000_000n,
    metadataURI: "ipfs://shieldcredit/energy-grid-equity-tranche-b.json",
    requestedLoanAmount: 445_000_000_000n,
  },
  {
    assetType: 0,
    faceValue: 3_800_000_000_000n,
    metadataURI: "ipfs://shieldcredit/eu-green-bond-2030.json",
    requestedLoanAmount: 2_400_000_000_000n,
  },
  {
    assetType: 1,
    faceValue: 610_000_000_000n,
    metadataURI: "ipfs://shieldcredit/healthcare-claims-batch-q2.json",
    requestedLoanAmount: 300_000_000_000n,
  },
  {
    assetType: 2,
    faceValue: 5_400_000_000_000n,
    metadataURI: "ipfs://shieldcredit/abuja-mixed-use-development.json",
    requestedLoanAmount: 3_000_000_000_000n,
  },
  {
    assetType: 3,
    faceValue: 1_350_000_000_000n,
    metadataURI: "ipfs://shieldcredit/agri-processing-equity-series-c.json",
    requestedLoanAmount: 675_000_000_000n,
  },
] as const;

function loadDeployment() {
  const deploymentPath = path.join(__dirname, "../deployments/sepolia.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("Missing deployments/sepolia.json. Deploy the contracts first.");
  }

  return JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as DeploymentFile;
}

async function encryptUint64(
  contractAddress: string,
  userAddress: string,
  value: bigint,
  rpcUrl: string,
) {
  const instance = await createInstance({
    ...SepoliaConfig,
    network: rpcUrl,
  });

  const buffer = instance.createEncryptedInput(contractAddress, userAddress);
  buffer.add64(value);

  const { handles, inputProof } = await buffer.encrypt();

  return {
    handle: zeroPadValue(hexlify(handles[0]), 32),
    inputProof,
  };
}

async function main() {
  if (!process.env.SEPOLIA_RPC_URL || !process.env.PRIVATE_KEY) {
    throw new Error("SEPOLIA_RPC_URL and PRIVATE_KEY are required.");
  }

  const deployment = loadDeployment();
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const rwaRegistry = new ethers.Contract(deployment.contracts.RWARegistry, RWA_REGISTRY_ABI, wallet);
  const privateLending = new ethers.Contract(deployment.contracts.PrivateLending, PRIVATE_LENDING_ABI, wallet);

  const currentAssetCount = Number(await rwaRegistry.totalAssets());
  console.log(`Current asset count: ${currentAssetCount}`);

  for (const [index, asset] of SEED_ASSETS.entries()) {
    if (index < currentAssetCount) {
      console.log(`Seed asset ${index} already exists. Skipping asset registration.`);
      continue;
    }

    const { handle, inputProof } = await encryptUint64(
      deployment.contracts.RWARegistry,
      wallet.address,
      asset.faceValue,
      process.env.SEPOLIA_RPC_URL,
    );

    console.log(`Registering seed asset ${index}...`);
    const tx = await rwaRegistry.registerAsset(handle, inputProof, asset.assetType, asset.metadataURI);
    await tx.wait();
    console.log(`Seed asset ${index} confirmed: ${tx.hash}`);
  }

  const borrowerLoans: bigint[] = await privateLending.getBorrowerLoans(wallet.address);
  const existingLoanAssetIds = new Set<string>();

  for (const loanId of borrowerLoans) {
    const loanInfo = await privateLending.getLoanInfo(loanId);
    existingLoanAssetIds.add(loanInfo.assetId.toString());
  }

  for (const [assetId, asset] of SEED_ASSETS.entries()) {
    if (!asset.requestedLoanAmount) {
      continue;
    }

    if (existingLoanAssetIds.has(assetId.toString())) {
      console.log(`Seed loan for asset ${assetId} already exists. Skipping loan origination.`);
      continue;
    }

    const { handle, inputProof } = await encryptUint64(
      deployment.contracts.PrivateLending,
      wallet.address,
      asset.requestedLoanAmount,
      process.env.SEPOLIA_RPC_URL,
    );

    console.log(`Opening seeded confidential loan for asset ${assetId}...`);
    const tx = await privateLending.requestLoan(BigInt(assetId), handle, inputProof);
    await tx.wait();
    console.log(`Seed loan for asset ${assetId} confirmed: ${tx.hash}`);
  }

  const [finalAssetCount, finalBorrowerLoans] = await Promise.all([
    rwaRegistry.totalAssets(),
    privateLending.getBorrowerLoans(wallet.address),
  ]);

  console.log(`Final asset count: ${finalAssetCount.toString()}`);
  console.log(`Borrower loan count: ${finalBorrowerLoans.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
