import { hexlify, toBeHex, zeroPadValue } from "ethers";
import type { JsonRpcSigner } from "ethers";
import { protocolConfig } from "./protocol-config";
import { getActiveWalletProvider } from "./wagmi";

type DecryptSigner = JsonRpcSigner | {
  address: string;
  signTypedData: JsonRpcSigner["signTypedData"];
};

type RelayerModule = typeof import("@zama-fhe/relayer-sdk/web");
type FhevmInstance = Awaited<ReturnType<RelayerModule["createInstance"]>>;
type HandleContractPair = { handle: string; contractAddress: string };
type PublicDecryptResults = Awaited<ReturnType<FhevmInstance["publicDecrypt"]>>;

let sdkReady = false;
let fhevmInstance: FhevmInstance | null = null;

async function loadRelayerModule() {
  return import("@zama-fhe/relayer-sdk/web");
}

async function ensureSdkReady() {
  if (!sdkReady) {
    const { initSDK } = await loadRelayerModule();
    await initSDK();
    sdkReady = true;
  }
}

function relayerAuth() {
  return protocolConfig.relayerApiKey
    ? { __type: "ApiKeyHeader" as const, value: protocolConfig.relayerApiKey }
    : undefined;
}

function normalizeHandle(handle: bigint | string) {
  if (typeof handle === "string") {
    if (handle.startsWith("0x")) {
      return zeroPadValue(handle, 32);
    }

    return zeroPadValue(toBeHex(BigInt(handle)), 32);
  }

  return zeroPadValue(toBeHex(handle), 32);
}

async function resolveRelayerNetwork(providerLike?: unknown) {
  if (protocolConfig.rpcUrl) {
    return protocolConfig.rpcUrl;
  }

  return (providerLike ?? await getActiveWalletProvider()) as any;
}

export async function getOrCreateFhevmInstance(providerLike?: unknown): Promise<FhevmInstance> {
  if (fhevmInstance) {
    return fhevmInstance;
  }

  await ensureSdkReady();
  const { SepoliaConfig, createInstance } = await loadRelayerModule();

  fhevmInstance = await createInstance({
    ...SepoliaConfig,
    network: await resolveRelayerNetwork(providerLike),
    auth: relayerAuth(),
  });

  return fhevmInstance;
}

export async function encryptUint64(
  inst: FhevmInstance,
  contractAddress: string,
  userAddress: string,
  amount: bigint,
): Promise<{ handle: string; inputProof: Uint8Array }> {
  const buffer = inst.createEncryptedInput(contractAddress, userAddress);
  buffer.add64(amount);

  const { handles, inputProof } = await buffer.encrypt({ auth: relayerAuth() });

  return {
    handle: normalizeHandle(hexlify(handles[0])),
    inputProof,
  };
}

export const encryptAmount = encryptUint64;

export async function userDecryptUint64s(
  inst: FhevmInstance,
  signer: DecryptSigner,
  userAddress: string,
  handles: HandleContractPair[],
  contractAddresses: string[],
): Promise<Record<string, bigint>> {
  const keypair = inst.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const eip712 = inst.createEIP712(
    keypair.publicKey,
    contractAddresses,
    startTimestamp,
    durationDays,
  );

  const signature = await signer.signTypedData(
    eip712.domain,
    {
      UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification as any,
    } as any,
    eip712.message as any,
  );

  const decrypted = await inst.userDecrypt(
    handles,
    keypair.privateKey,
    keypair.publicKey,
    signature,
    contractAddresses,
    userAddress,
    startTimestamp,
    durationDays,
    { auth: relayerAuth() },
  );

  const entries = Object.entries(decrypted).map(([handle, value]) => [
    normalizeHandle(handle),
    BigInt(value as string | number | bigint | boolean),
  ]);
  return Object.fromEntries(entries);
}

export async function reencryptBalance(
  inst: FhevmInstance,
  signer: DecryptSigner,
  contractAddress: string,
  handle: bigint | string,
) {
  const userAddress = "getAddress" in signer ? await signer.getAddress() : signer.address;
  const normalizedHandle = normalizeHandle(handle);
  const decrypted = await userDecryptUint64s(
    inst,
    signer,
    userAddress,
    [{ handle: normalizedHandle, contractAddress }],
    [contractAddress],
  );

  return decrypted[normalizedHandle];
}

export async function publicDecryptHandles(
  inst: FhevmInstance,
  handles: string[],
): Promise<PublicDecryptResults> {
  return inst.publicDecrypt(handles, { auth: relayerAuth() });
}

export async function publicDecryptUint64s(
  inst: FhevmInstance,
  handles: string[],
): Promise<Record<string, bigint>> {
  const decrypted = await publicDecryptHandles(inst, handles);
  const entries = Object.entries(decrypted.clearValues).map(([handle, value]) => [
    normalizeHandle(handle),
    BigInt(value as string | number | bigint | boolean),
  ]);
  return Object.fromEntries(entries);
}

export function resetFhevmInstance() {
  fhevmInstance = null;
}
