import { ethers, network } from "hardhat";
import { createInstance } from "fhevmjs";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("=== ShieldCredit End-to-End Demo ===\n");

  // 1. Load deployments
  const deploymentsPath = path.join(__dirname, "../deployments/sepolia.json");
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error("Run deploy:sepolia first to generate deployments/sepolia.json");
  }
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
  const { ConfidentialStablecoin, RWARegistry, CreditScore, PrivateLending } =
    deployments.contracts;

  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const regulator = signers[3] ?? signers[0];

  console.log("Using deployer:", deployer.address);
  console.log("Using regulator:", regulator.address);

  // 2. Init fhevmjs instance
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const instance = await createInstance({ chainId: Number(chainId) });
  console.log("fhevmjs instance created for chainId:", chainId);

  // Get contract factories
  const rwaRegistry = await ethers.getContractAt("RWARegistry", RWARegistry, deployer);
  const privateLending = await ethers.getContractAt("PrivateLending", PrivateLending, deployer);
  const stablecoin = await ethers.getContractAt(
    "ConfidentialStablecoin",
    ConfidentialStablecoin,
    deployer
  );

  // 3. Encrypt 10_000_000 face value and register asset
  console.log("\n--- Step 1: Register RWA Asset ---");
  const faceValueInput = instance.createEncryptedInput(RWARegistry, deployer.address);
  faceValueInput.add64(10_000_000n);
  const { handles: fvHandles, inputProof: fvProof } = await faceValueInput.encrypt();

  const registerTx = await rwaRegistry.registerAsset(
    fvHandles[0],
    fvProof,
    0, // TREASURY_BOND
    "ipfs://QmAssetMetadata"
  );
  const registerReceipt = await registerTx.wait();
  const registerEvent = registerReceipt?.logs.find(
    (log: any) => log.fragment?.name === "AssetRegistered"
  );
  const assetId = (registerEvent as any)?.args?.[0] ?? 0n;
  console.log("Asset registered with ID:", assetId.toString());

  // 4. Encrypt 6_000_000 loan amount and request loan
  console.log("\n--- Step 2: Request Loan ---");
  const loanInput = instance.createEncryptedInput(PrivateLending, deployer.address);
  loanInput.add64(6_000_000n);
  const { handles: loanHandles, inputProof: loanProof } = await loanInput.encrypt();

  const loanTx = await privateLending.requestLoan(assetId, loanHandles[0], loanProof);
  const loanReceipt = await loanTx.wait();
  const loanEvent = loanReceipt?.logs.find((log: any) => log.fragment?.name === "LoanCreated");
  const loanId = (loanEvent as any)?.args?.[0] ?? 0n;
  console.log("Loan created with ID:", loanId.toString());

  // 5. Re-encrypt and decrypt stablecoin balance
  console.log("\n--- Step 3: Check Balance ---");
  const balanceHandle = await stablecoin.balanceOf(deployer.address);
  const { publicKey, privateKey } = instance.generateKeypair();
  const eip712 = instance.createEIP712(publicKey, ConfidentialStablecoin);
  const signature = await deployer.signTypedData(
    eip712.domain,
    { Reencrypt: eip712.types.Reencrypt },
    eip712.message
  );
  const balance = await instance.reencrypt(
    balanceHandle,
    privateKey,
    publicKey,
    signature,
    ConfidentialStablecoin,
    deployer.address
  );
  console.log("Stablecoin balance after loan:", balance.toString(), "sUSD (in micro-units)");

  // 6. Fast-forward 30 days and accrue interest
  console.log("\n--- Step 4: Advance Time 30 Days ---");
  await network.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
  await network.provider.send("evm_mine", []);

  const accrueTx = await privateLending.accrueInterest(loanId);
  await accrueTx.wait();
  console.log("Interest accrued after 30 days");

  // 7. Partial repayment of 3_000_000
  console.log("\n--- Step 5: Partial Repayment ---");
  const repayInput = instance.createEncryptedInput(PrivateLending, deployer.address);
  repayInput.add64(3_000_000n);
  const { handles: repayHandles, inputProof: repayProof } = await repayInput.encrypt();

  const repayTx = await privateLending.repayLoan(loanId, repayHandles[0], repayProof);
  await repayTx.wait();
  console.log("Partial repayment of 3,000,000 processed");

  // 8. Regulator audits outstanding balance
  console.log("\n--- Step 6: Regulator Audit ---");
  const regulatorLending = await ethers.getContractAt("PrivateLending", PrivateLending, regulator);
  const [, outstandingHandle] = await regulatorLending.getEncryptedLoanFields(loanId);

  const { publicKey: regPk, privateKey: regSk } = instance.generateKeypair();
  const regEip712 = instance.createEIP712(regPk, PrivateLending);
  const regSignature = await regulator.signTypedData(
    regEip712.domain,
    { Reencrypt: regEip712.types.Reencrypt },
    regEip712.message
  );
  const outstanding = await instance.reencrypt(
    outstandingHandle,
    regSk,
    regPk,
    regSignature,
    PrivateLending,
    regulator.address
  );
  console.log("Outstanding balance (regulator view):", outstanding.toString(), "sUSD");

  console.log("\n=== Demo Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
