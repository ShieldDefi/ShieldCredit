import { createInstance } from "fhevmjs/node";
import type { FhevmInstance } from "fhevmjs/node";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// Sepolia fhEVM contract addresses from ZamaFHEVMConfig
const SEPOLIA_ACL_ADDRESS = "0xFee8407e2f5e3Ee68ad77cAE98c434e637f516e5";
const SEPOLIA_KMS_ADDRESS = "0x9D6891A6240D6130c54ae243d8005063D05fE14b";

export async function getFhevmInstance(
  kmsContractAddress = SEPOLIA_KMS_ADDRESS,
  aclContractAddress = SEPOLIA_ACL_ADDRESS,
  chainId = 31337
): Promise<FhevmInstance> {
  return createInstance({ kmsContractAddress, aclContractAddress, chainId });
}

export async function encryptUint64(
  inst: FhevmInstance,
  contractAddr: string,
  userAddr: string,
  value: bigint
): Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }> {
  const input = inst.createEncryptedInput(contractAddr, userAddr);
  input.add64(value);
  return input.encrypt();
}

export async function encryptUint32(
  inst: FhevmInstance,
  contractAddr: string,
  userAddr: string,
  value: number
): Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }> {
  const input = inst.createEncryptedInput(contractAddr, userAddr);
  input.add32(value);
  return input.encrypt();
}

export async function reencryptAndDecrypt(
  inst: FhevmInstance,
  signer: HardhatEthersSigner,
  contractAddr: string,
  handle: bigint
): Promise<bigint> {
  const { publicKey, privateKey } = inst.generateKeypair();
  const eip712 = inst.createEIP712(publicKey, contractAddr);
  const signature = await signer.signTypedData(
    eip712.domain,
    { Reencrypt: eip712.types.Reencrypt },
    eip712.message
  );
  return inst.reencrypt(handle, privateKey, publicKey, signature, contractAddr, signer.address);
}

/**
 * Convert a Uint8Array handle (from fhevmjs encrypt()) to a bytes32 hex string
 * suitable for passing to Solidity einput parameters.
 */
export function handleToBytes32(handle: Uint8Array): string {
  return "0x" + Buffer.from(handle).toString("hex").padStart(64, "0");
}
