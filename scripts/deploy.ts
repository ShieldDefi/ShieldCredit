import hre, { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

type VerificationTarget = {
  name: string;
  address: string;
  constructorArguments: unknown[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyContracts(targets: VerificationTarget[]) {
  if (network.name === "hardhat") {
    return;
  }

  if (!process.env.ETHERSCAN_API_KEY) {
    console.log("Skipping verification: ETHERSCAN_API_KEY is not configured.");
    return;
  }

  console.log("\nWaiting for Etherscan indexing before verification...");
  await sleep(20_000);

  for (const target of targets) {
    try {
      await hre.run("verify:verify", {
        address: target.address,
        constructorArguments: target.constructorArguments,
      });
      console.log(`Verified ${target.name}: ${target.address}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already verified")) {
        console.log(`${target.name} is already verified: ${target.address}`);
      } else {
        console.warn(`Verification failed for ${target.name}: ${message}`);
      }
    }
  }
}

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const auditorSigner = signers[1] ?? signers[0];
  const oracleSigner = signers[2] ?? signers[0];
  const regulatorSigner = signers[3] ?? signers[0];

  const providerNetwork = await ethers.provider.getNetwork();
  const chainId = Number(providerNetwork.chainId);
  const networkName = network.name === "unknown" && chainId === 31337 ? "hardhat" : network.name;

  console.log("Deploying ShieldCredit contracts...");
  console.log("Network:", networkName, `(${chainId})`);
  console.log("Deployer:", deployer.address);
  console.log("Auditor:", auditorSigner.address);
  console.log("Oracle:", oracleSigner.address);
  console.log("Regulator:", regulatorSigner.address);

  const StablecoinFactory = await ethers.getContractFactory("ConfidentialStablecoin");
  const stablecoin = await StablecoinFactory.deploy();
  await stablecoin.waitForDeployment();
  const stablecoinAddress = await stablecoin.getAddress();
  console.log("ConfidentialStablecoin deployed to:", stablecoinAddress);

  const FaucetFactory = await ethers.getContractFactory("TestStablecoinFaucet");
  const stablecoinFaucet = await FaucetFactory.deploy(stablecoinAddress);
  await stablecoinFaucet.waitForDeployment();
  const stablecoinFaucetAddress = await stablecoinFaucet.getAddress();
  console.log("TestStablecoinFaucet deployed to:", stablecoinFaucetAddress);

  const RWARegistryFactory = await ethers.getContractFactory("RWARegistry");
  const rwaRegistry = await RWARegistryFactory.deploy();
  await rwaRegistry.waitForDeployment();
  const rwaRegistryAddress = await rwaRegistry.getAddress();
  console.log("RWARegistry deployed to:", rwaRegistryAddress);

  const CreditScoreFactory = await ethers.getContractFactory("CreditScore");
  const creditScore = await CreditScoreFactory.deploy();
  await creditScore.waitForDeployment();
  const creditScoreAddress = await creditScore.getAddress();
  console.log("CreditScore deployed to:", creditScoreAddress);

  const PrivateLendingFactory = await ethers.getContractFactory("PrivateLending");
  const privateLending = await PrivateLendingFactory.deploy(
    rwaRegistryAddress,
    creditScoreAddress,
    stablecoinAddress,
  );
  await privateLending.waitForDeployment();
  const privateLendingAddress = await privateLending.getAddress();
  console.log("PrivateLending deployed to:", privateLendingAddress);

  console.log("\nWiring contracts...");

  await (await rwaRegistry.setAuditor(auditorSigner.address)).wait();
  console.log("RWARegistry: auditor set to", auditorSigner.address);

  await (await rwaRegistry.setLendingContract(privateLendingAddress)).wait();
  console.log("RWARegistry: lending contract set to", privateLendingAddress);

  await (await creditScore.setLendingContract(privateLendingAddress)).wait();
  console.log("CreditScore: lending contract set to", privateLendingAddress);

  await (await creditScore.setScoringOracle(oracleSigner.address)).wait();
  console.log("CreditScore: oracle set to", oracleSigner.address);

  await (await stablecoin.allowLendingContract(privateLendingAddress)).wait();
  console.log("Stablecoin: lending contract allowed:", privateLendingAddress);

  await (await stablecoin.setAuthorizedMinter(stablecoinFaucetAddress, true)).wait();
  console.log("Stablecoin: faucet minter allowed:", stablecoinFaucetAddress);

  await (await stablecoin.transferOwnership(privateLendingAddress)).wait();
  console.log("Stablecoin: ownership transferred to PrivateLending");

  await (await rwaRegistry.whitelistIssuer(deployer.address)).wait();
  console.log("RWARegistry: deployer whitelisted as issuer");

  await (await privateLending.setRegulator(regulatorSigner.address)).wait();
  console.log("PrivateLending: regulator set to", regulatorSigner.address);

  const deployments = {
    network: networkName,
    chainId,
    deployer: deployer.address,
    auditor: auditorSigner.address,
    oracle: oracleSigner.address,
    regulator: regulatorSigner.address,
    contracts: {
      ConfidentialStablecoin: stablecoinAddress,
      TestStablecoinFaucet: stablecoinFaucetAddress,
      RWARegistry: rwaRegistryAddress,
      CreditScore: creditScoreAddress,
      PrivateLending: privateLendingAddress,
    },
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const outFile = path.join(deploymentsDir, `${networkName}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deployments, null, 2));
  console.log("\nDeployment info written to:", outFile);

  const frontendEnvFile = path.join(__dirname, "../frontend/.env.local");
  const frontendEnv = [
    `NEXT_PUBLIC_RWA_REGISTRY_ADDRESS=${rwaRegistryAddress}`,
    `NEXT_PUBLIC_CREDIT_SCORE_ADDRESS=${creditScoreAddress}`,
    `NEXT_PUBLIC_PRIVATE_LENDING_ADDRESS=${privateLendingAddress}`,
    `NEXT_PUBLIC_STABLECOIN_ADDRESS=${stablecoinAddress}`,
    `NEXT_PUBLIC_STABLECOIN_FAUCET_ADDRESS=${stablecoinFaucetAddress}`,
    `NEXT_PUBLIC_CHAIN_ID=${chainId}`,
    `NEXT_PUBLIC_SEPOLIA_RPC_URL=${process.env.SEPOLIA_RPC_URL ?? ""}`,
    `NEXT_PUBLIC_ZAMA_RELAYER_API_KEY=${process.env.ZAMA_RELAYER_API_KEY ?? ""}`,
    `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? ""}`,
  ].join("\n");

  fs.writeFileSync(frontendEnvFile, `${frontendEnv}\n`);
  console.log("Frontend environment written to:", frontendEnvFile);

  const deploymentTargets: VerificationTarget[] = [
    {
      name: "ConfidentialStablecoin",
      address: stablecoinAddress,
      constructorArguments: [],
    },
    {
      name: "TestStablecoinFaucet",
      address: stablecoinFaucetAddress,
      constructorArguments: [stablecoinAddress],
    },
    {
      name: "RWARegistry",
      address: rwaRegistryAddress,
      constructorArguments: [],
    },
    {
      name: "CreditScore",
      address: creditScoreAddress,
      constructorArguments: [],
    },
    {
      name: "PrivateLending",
      address: privateLendingAddress,
      constructorArguments: [rwaRegistryAddress, creditScoreAddress, stablecoinAddress],
    },
  ];

  await verifyContracts(deploymentTargets);

  console.log("\n=== Deployment Summary ===");
  console.log(JSON.stringify(deployments.contracts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
