import { createInstance, type FhevmInstance } from "fhevmjs";
import type { BrowserProvider } from "ethers";

let fhevmInstance: FhevmInstance | null = null;

export async function getOrCreateFhevmInstance(provider: BrowserProvider): Promise<FhevmInstance> {
  if (fhevmInstance) return fhevmInstance;

  const network = await provider.getNetwork();
  fhevmInstance = await createInstance({
    chainId: Number(network.chainId),
    provider,
  });

  return fhevmInstance;
}

export async function encryptAmount(
  inst: FhevmInstance,
  contractAddress: string,
  userAddress: string,
  amount: bigint
): Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }> {
  const input = inst.createEncryptedInput(contractAddress, userAddress);
  input.add64(amount);
  return input.encrypt();
}

export async function reencryptBalance(
  inst: FhevmInstance,
  signer: { address: string; signTypedData: (domain: object, types: object, value: object) => Promise<string> },
  contractAddress: string,
  handle: bigint
): Promise<bigint> {
  const { publicKey, privateKey } = inst.generateKeypair();
  const eip712 = inst.createEIP712(publicKey, contractAddress);
  const signature = await signer.signTypedData(
    eip712.domain,
    { Reencrypt: eip712.types.Reencrypt },
    eip712.message
  );
  return inst.reencrypt(handle, privateKey, publicKey, signature, contractAddress, signer.address);
}

export function resetFhevmInstance(): void {
  fhevmInstance = null;
}
