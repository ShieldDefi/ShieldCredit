import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const auditorSigner = signers[1] ?? signers[0];
  const oracleSigner = signers[2] ?? signers[0];
  const regulatorSigner = signers[3] ?? signers[0];

  console.log("Deploying ShieldCredit contracts...");
  console.log("Deployer:", deployer.address);
  console.log("Auditor:", auditorSigner.address);
  console.log("Oracle:", oracleSigner.address);
  console.log("Regulator:", regulatorSigner.address);

  // 1. Deploy ConfidentialStablecoin
  const StablecoinFactory = await ethers.getContractFactory("ConfidentialStablecoin");
  const stablecoin = await StablecoinFactory.deploy();
  await stablecoin.waitForDeployment();
  const stablecoinAddress = await stablecoin.getAddress();
  console.log("ConfidentialStablecoin deployed to:", stablecoinAddress);

  // 2. Deploy RWARegistry
  const RWARegistryFactory = await ethers.getContractFactory("RWARegistry");
  const rwaRegistry = await RWARegistryFactory.deploy();
  await rwaRegistry.waitForDeployment();
  const rwaRegistryAddress = await rwaRegistry.getAddress();
  console.log("RWARegistry deployed to:", rwaRegistryAddress);

  // 3. Deploy CreditScore
  const CreditScoreFactory = await ethers.getContractFactory("CreditScore");
  const creditScore = await CreditScoreFactory.deploy();
  await creditScore.waitForDeployment();
  const creditScoreAddress = await creditScore.getAddress();
  console.log("CreditScore deployed to:", creditScoreAddress);

  // 4. Deploy PrivateLending
  const PrivateLendingFactory = await ethers.getContractFactory("PrivateLending");
  const privateLending = await PrivateLendingFactory.deploy(
    rwaRegistryAddress,
    creditScoreAddress,
    stablecoinAddress
  );
  await privateLending.waitForDeployment();
  const privateLendingAddress = await privateLending.getAddress();
  console.log("PrivateLending deployed to:", privateLendingAddress);

  // 5. Wire contracts
  console.log("\nWiring contracts...");

  const tx1 = await rwaRegistry.setAuditor(auditorSigner.address);
  await tx1.wait();
  console.log("RWARegistry: auditor set to", auditorSigner.address);

  const tx2 = await creditScore.setLendingContract(privateLendingAddress);
  await tx2.wait();
  console.log("CreditScore: lending contract set to", privateLendingAddress);

  const tx3 = await creditScore.setScoringOracle(oracleSigner.address);
  await tx3.wait();
  console.log("CreditScore: oracle set to", oracleSigner.address);

  const tx4 = await stablecoin.allowLendingContract(privateLendingAddress);
  await tx4.wait();
  console.log("Stablecoin: lending contract allowed:", privateLendingAddress);

  const tx5 = await stablecoin.transferOwnership(privateLendingAddress);
  await tx5.wait();
  console.log("Stablecoin: ownership transferred to PrivateLending");

  const tx6 = await rwaRegistry.whitelistIssuer(deployer.address);
  await tx6.wait();
  console.log("RWARegistry: deployer whitelisted as issuer");

  const tx7 = await privateLending.setRegulator(regulatorSigner.address);
  await tx7.wait();
  console.log("PrivateLending: regulator set to", regulatorSigner.address);

  // 6. Write deployments file
  const deployments = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    auditor: auditorSigner.address,
    oracle: oracleSigner.address,
    regulator: regulatorSigner.address,
    contracts: {
      ConfidentialStablecoin: stablecoinAddress,
      RWARegistry: rwaRegistryAddress,
      CreditScore: creditScoreAddress,
      PrivateLending: privateLendingAddress,
    },
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const network = (await ethers.provider.getNetwork()).name;
  const outFile = path.join(deploymentsDir, `${network === "unknown" ? "hardhat" : network}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deployments, null, 2));
  console.log("\nDeployment info written to:", outFile);

  console.log("\n=== Deployment Summary ===");
  console.log(JSON.stringify(deployments.contracts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
