import { createInstance } from "fhevmjs";
import type { FhevmInstance } from "fhevmjs/node";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export async function getFhevmInstance(): Promise<FhevmInstance> {
  return createInstance({ chainId: 31337 });
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
