import { ethers } from "hardhat";
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node";
import * as fs from "fs";
import * as path from "path";

async function decryptHandle(
  instance: Awaited<ReturnType<typeof createInstance>>,
  signer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  contractAddress: string,
  handle: bigint,
) {
  const { publicKey, privateKey } = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const eip712 = instance.createEIP712(publicKey, [contractAddress], startTimestamp, durationDays);

  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification as any } as any,
    eip712.message as any,
  );

  const decrypted = await instance.userDecrypt(
    [{ handle: ethers.zeroPadValue(ethers.toBeHex(handle), 32), contractAddress }],
    privateKey,
    publicKey,
    signature,
    [contractAddress],
    signer.address,
    startTimestamp,
    durationDays,
  );

  const handleKey = Object.keys(decrypted)[0] as `0x${string}`;
  const value = decrypted[handleKey];
  return BigInt(value as string | number | bigint | boolean);
}

async function main() {
  console.log("=== ShieldCredit Relayer Demo ===\n");

  if (!process.env.SEPOLIA_RPC_URL) {
    throw new Error("SEPOLIA_RPC_URL is required to run the demo.");
  }

  const deploymentsPath = path.join(__dirname, "../deployments/sepolia.json");
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error("Run deploy:sepolia first to generate deployments/sepolia.json");
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
  const { ConfidentialStablecoin, PrivateLending } = deployments.contracts;

  const [deployer] = await ethers.getSigners();
  const stablecoin = await ethers.getContractAt("ConfidentialStablecoin", ConfidentialStablecoin, deployer);
  const lending = await ethers.getContractAt("PrivateLending", PrivateLending, deployer);

  const instance = await createInstance({
    ...SepoliaConfig,
    network: process.env.SEPOLIA_RPC_URL,
  });

  console.log("Using deployer:", deployer.address);
  console.log("Stablecoin:", ConfidentialStablecoin);
  console.log("PrivateLending:", PrivateLending);

  const borrowerLoans = await lending.getBorrowerLoans(deployer.address);
  console.log("Borrower loans:", borrowerLoans.map((loanId: bigint) => loanId.toString()));

  const balanceHandle = await stablecoin.balanceOf(deployer.address);
  const balance = await decryptHandle(instance, deployer, ConfidentialStablecoin, balanceHandle);
  console.log("Decrypted stablecoin balance:", balance.toString(), "micro-sUSD");

  console.log("\n=== Demo Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
