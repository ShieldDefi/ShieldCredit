import { createInstance, type FhevmInstance } from "fhevmjs";
import type { BrowserProvider } from "ethers";

let fhevmInstance: FhevmInstance | null = null;

export async function getOrCreateFhevmInstance(provider: BrowserProvider): Promise<FhevmInstance> {
  if (fhevmInstance) return fhevmInstance;

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  // Sepolia fhEVM contract addresses (from ZamaFHEVMConfig)
  const kmsContractAddress = "0x9D6891A6240D6130c54ae243d8005063D05fE14b";
  const aclContractAddress = "0xFee8407e2f5e3Ee68ad77cAE98c434e637f516e5";

  fhevmInstance = await createInstance({
    kmsContractAddress,
    aclContractAddress,
    chainId,
    network: provider,
  });

  return fhevmInstance;
}

export async function encryptAmount(
  inst: FhevmInstance,
  contractAddress: string,
  userAddress: string,
  amount: bigint
): Promise<{ handle: string; inputProof: Uint8Array }> {
  const input = inst.createEncryptedInput(contractAddress, userAddress);
  input.add64(amount);
  const { handles, inputProof } = await input.encrypt();
  const handle = "0x" + Buffer.from(handles[0]).toString("hex").padStart(64, "0");
  return { handle, inputProof };
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
