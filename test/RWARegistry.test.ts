import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { RWARegistry } from "../typechain-types";
import { getFhevmInstance, encryptUint64, reencryptAndDecrypt } from "./helpers/fhevm-test-helpers";
import type { FhevmInstance } from "fhevmjs/node";

describe("RWARegistry", function () {
  let rwaRegistry: RWARegistry;
  let owner: HardhatEthersSigner;
  let auditor: HardhatEthersSigner;
  let issuer: HardhatEthersSigner;
  let nonIssuer: HardhatEthersSigner;
  let lendingContract: HardhatEthersSigner;
  let inst: FhevmInstance;
  let registryAddress: string;

  beforeEach(async function () {
    [owner, auditor, issuer, nonIssuer, lendingContract] = await ethers.getSigners();

    const RWARegistryFactory = await ethers.getContractFactory("RWARegistry");
    rwaRegistry = (await RWARegistryFactory.deploy()) as RWARegistry;
    await rwaRegistry.waitForDeployment();
    registryAddress = await rwaRegistry.getAddress();

    await rwaRegistry.connect(owner).whitelistIssuer(issuer.address);
    await rwaRegistry.connect(owner).setAuditor(auditor.address);

    inst = await getFhevmInstance();
  });

  describe("registerAsset", function () {
    it("should reject non-whitelisted issuer", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        registryAddress,
        nonIssuer.address,
        1_000_000n
      );
      await expect(
        rwaRegistry.connect(nonIssuer).registerAsset(handles[0], inputProof, 0, "ipfs://test")
      ).to.be.revertedWith("RWARegistry: issuer not whitelisted");
    });

    it("should register asset and emit AssetRegistered", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        registryAddress,
        issuer.address,
        1_000_000n
      );
      await expect(
        rwaRegistry.connect(issuer).registerAsset(handles[0], inputProof, 0, "ipfs://metadata1")
      )
        .to.emit(rwaRegistry, "AssetRegistered")
        .withArgs(0n, issuer.address, 0);

      const total = await rwaRegistry.totalAssets();
      expect(total).to.equal(1n);
    });

    it("should allow owner to decrypt face value", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        registryAddress,
        issuer.address,
        5_000_000n
      );
      await rwaRegistry.connect(issuer).registerAsset(handles[0], inputProof, 1, "ipfs://bond");

      // Owner can get the face value handle
      const fvHandle = await rwaRegistry.connect(issuer).getFaceValue(0n);
      expect(fvHandle).to.not.equal(0n);

      // Decrypt via re-encryption
      const decrypted = await reencryptAndDecrypt(
        inst,
        issuer,
        registryAddress,
        fvHandle
      );
      expect(decrypted).to.equal(5_000_000n);
    });

    it("should prevent non-owner from decrypting face value", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        registryAddress,
        issuer.address,
        1_000_000n
      );
      await rwaRegistry.connect(issuer).registerAsset(handles[0], inputProof, 0, "ipfs://t");

      await expect(
        rwaRegistry.connect(nonIssuer).getFaceValue(0n)
      ).to.be.revertedWith("RWARegistry: not authorized");
    });

    it("should allow auditor to decrypt face value", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        registryAddress,
        issuer.address,
        2_000_000n
      );
      await rwaRegistry.connect(issuer).registerAsset(handles[0], inputProof, 2, "ipfs://re");

      const fvHandle = await rwaRegistry.connect(auditor).getFaceValue(0n);
      expect(fvHandle).to.not.equal(0n);

      const decrypted = await reencryptAndDecrypt(
        inst,
        auditor,
        registryAddress,
        fvHandle
      );
      expect(decrypted).to.equal(2_000_000n);
    });
  });

  describe("lockAsset / unlockAsset", function () {
    let assetId: bigint;

    beforeEach(async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        registryAddress,
        issuer.address,
        1_000_000n
      );
      const tx = await rwaRegistry
        .connect(issuer)
        .registerAsset(handles[0], inputProof, 0, "ipfs://lock-test");
      const receipt = await tx.wait();
      const event = receipt?.logs.find((l: any) => l.fragment?.name === "AssetRegistered");
      assetId = (event as any)?.args?.[0] ?? 0n;
    });

    it("should lock asset on lockAsset call", async function () {
      await rwaRegistry.connect(issuer).lockAsset(assetId, lendingContract.address);
      const locked = await rwaRegistry.isLocked(assetId);
      expect(locked).to.be.true;
    });

    it("should prevent transfer of locked asset", async function () {
      await rwaRegistry.connect(issuer).lockAsset(assetId, lendingContract.address);
      await expect(
        rwaRegistry.connect(issuer).transferAsset(assetId, nonIssuer.address)
      ).to.be.revertedWith("RWARegistry: asset is locked");
    });

    it("should unlock asset when called by lockedBy", async function () {
      await rwaRegistry.connect(issuer).lockAsset(assetId, lendingContract.address);
      await rwaRegistry.connect(lendingContract).unlockAsset(assetId);
      const locked = await rwaRegistry.isLocked(assetId);
      expect(locked).to.be.false;
    });
  });

  describe("transferAsset", function () {
    it("should transfer asset and update owner", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        registryAddress,
        issuer.address,
        3_000_000n
      );
      await rwaRegistry.connect(issuer).registerAsset(handles[0], inputProof, 3, "ipfs://eq");
      await expect(rwaRegistry.connect(issuer).transferAsset(0n, nonIssuer.address))
        .to.emit(rwaRegistry, "AssetTransferred")
        .withArgs(0n, issuer.address, nonIssuer.address);

      const newOwner = await rwaRegistry.getAssetOwner(0n);
      expect(newOwner).to.equal(nonIssuer.address);
    });
  });
});
