import { expect } from "chai";
import { ethers, network } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  ConfidentialStablecoin,
  RWARegistry,
  CreditScore,
  PrivateLending,
} from "../typechain-types";
import { getFhevmInstance, encryptUint64, reencryptAndDecrypt } from "./helpers/fhevm-test-helpers";
import type { FhevmInstance } from "fhevmjs/node";

describe("PrivateLending", function () {
  let stablecoin: ConfidentialStablecoin;
  let rwaRegistry: RWARegistry;
  let creditScore: CreditScore;
  let privateLending: PrivateLending;

  let owner: HardhatEthersSigner;
  let auditor: HardhatEthersSigner;
  let oracle: HardhatEthersSigner;
  let regulator: HardhatEthersSigner;
  let borrower: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  let inst: FhevmInstance;
  let stablecoinAddress: string;
  let registryAddress: string;
  let creditScoreAddress: string;
  let lendingAddress: string;

  let testAssetId: bigint;

  beforeEach(async function () {
    [owner, auditor, oracle, regulator, borrower, stranger] = await ethers.getSigners();

    // Deploy contracts
    const StablecoinFactory = await ethers.getContractFactory("ConfidentialStablecoin");
    stablecoin = (await StablecoinFactory.deploy()) as ConfidentialStablecoin;
    await stablecoin.waitForDeployment();
    stablecoinAddress = await stablecoin.getAddress();

    const RWARegistryFactory = await ethers.getContractFactory("RWARegistry");
    rwaRegistry = (await RWARegistryFactory.deploy()) as RWARegistry;
    await rwaRegistry.waitForDeployment();
    registryAddress = await rwaRegistry.getAddress();

    const CreditScoreFactory = await ethers.getContractFactory("CreditScore");
    creditScore = (await CreditScoreFactory.deploy()) as CreditScore;
    await creditScore.waitForDeployment();
    creditScoreAddress = await creditScore.getAddress();

    const PrivateLendingFactory = await ethers.getContractFactory("PrivateLending");
    privateLending = (await PrivateLendingFactory.deploy(
      registryAddress,
      creditScoreAddress,
      stablecoinAddress
    )) as PrivateLending;
    await privateLending.waitForDeployment();
    lendingAddress = await privateLending.getAddress();

    // Wire contracts
    await rwaRegistry.connect(owner).setAuditor(auditor.address);
    await creditScore.connect(owner).setLendingContract(lendingAddress);
    await creditScore.connect(owner).setScoringOracle(oracle.address);
    await stablecoin.connect(owner).allowLendingContract(lendingAddress);
    await stablecoin.connect(owner).transferOwnership(lendingAddress);
    await rwaRegistry.connect(owner).whitelistIssuer(borrower.address);
    await privateLending.connect(owner).setRegulator(regulator.address);

    inst = await getFhevmInstance();

    // Register test asset with face value 1_000_000
    const { handles, inputProof } = await encryptUint64(
      inst,
      registryAddress,
      borrower.address,
      1_000_000n
    );
    const tx = await rwaRegistry
      .connect(borrower)
      .registerAsset(handles[0], inputProof, 0, "ipfs://test-asset");
    const receipt = await tx.wait();
    const event = receipt?.logs.find((l: any) => l.fragment?.name === "AssetRegistered");
    testAssetId = (event as any)?.args?.[0] ?? 0n;
  });

  describe("requestLoan", function () {
    it("should approve loan within 70% LTV", async function () {
      // Face value = 1_000_000, max loan = 700_000 (70% LTV)
      const { handles, inputProof } = await encryptUint64(
        inst,
        lendingAddress,
        borrower.address,
        600_000n
      );
      const tx = await privateLending
        .connect(borrower)
        .requestLoan(testAssetId, handles[0], inputProof);
      const receipt = await tx.wait();
      const event = receipt?.logs.find((l: any) => l.fragment?.name === "LoanCreated");
      expect(event).to.not.be.undefined;
      const loanId = (event as any)?.args?.[0];
      expect(loanId).to.equal(0n);
    });

    it("should reject loan from non-owner of asset", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        lendingAddress,
        stranger.address,
        500_000n
      );
      await expect(
        privateLending.connect(stranger).requestLoan(testAssetId, handles[0], inputProof)
      ).to.be.revertedWith("PrivateLending: not asset owner");
    });

    it("should lock collateral asset on loan creation", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        lendingAddress,
        borrower.address,
        500_000n
      );
      await privateLending.connect(borrower).requestLoan(testAssetId, handles[0], inputProof);

      const isLocked = await rwaRegistry.isLocked(testAssetId);
      expect(isLocked).to.be.true;
    });

    it("should mint stablecoin to borrower", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        lendingAddress,
        borrower.address,
        500_000n
      );
      await privateLending.connect(borrower).requestLoan(testAssetId, handles[0], inputProof);

      const balanceHandle = await stablecoin.balanceOf(borrower.address);
      expect(balanceHandle).to.not.equal(0n);

      const balance = await reencryptAndDecrypt(inst, borrower, stablecoinAddress, balanceHandle);
      // The loan is TFHE.select(approved, loanAmount, 0) — with default score initialized at 600 >= 550, should be approved
      expect(balance).to.be.greaterThan(0n);
    });

    it("should set loan status to ACTIVE", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        lendingAddress,
        borrower.address,
        500_000n
      );
      await privateLending.connect(borrower).requestLoan(testAssetId, handles[0], inputProof);

      const status = await privateLending.getLoanStatus(0n);
      expect(status).to.equal(1); // LoanStatus.ACTIVE
    });

    it("should prevent requesting a loan on an already locked asset", async function () {
      const { handles: h1, inputProof: p1 } = await encryptUint64(
        inst,
        lendingAddress,
        borrower.address,
        500_000n
      );
      await privateLending.connect(borrower).requestLoan(testAssetId, h1[0], p1);

      const { handles: h2, inputProof: p2 } = await encryptUint64(
        inst,
        lendingAddress,
        borrower.address,
        300_000n
      );
      await expect(
        privateLending.connect(borrower).requestLoan(testAssetId, h2[0], p2)
      ).to.be.revertedWith("PrivateLending: asset already locked");
    });
  });

  describe("accrueInterest", function () {
    let loanId: bigint;

    beforeEach(async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        lendingAddress,
        borrower.address,
        500_000n
      );
      const tx = await privateLending
        .connect(borrower)
        .requestLoan(testAssetId, handles[0], inputProof);
      const receipt = await tx.wait();
      const event = receipt?.logs.find((l: any) => l.fragment?.name === "LoanCreated");
      loanId = (event as any)?.args?.[0] ?? 0n;
    });

    it("should accrue interest over time", async function () {
      // Advance 365 days
      await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
      await network.provider.send("evm_mine", []);

      await expect(privateLending.connect(borrower).accrueInterest(loanId))
        .to.emit(privateLending, "InterestAccrued")
        .withArgs(loanId, await getBlockTimestamp());
    });

    it("should emit InterestAccrued event", async function () {
      await network.provider.send("evm_increaseTime", [86400]); // 1 day
      await network.provider.send("evm_mine", []);

      const tx = await privateLending.connect(borrower).accrueInterest(loanId);
      await expect(tx).to.emit(privateLending, "InterestAccrued");
    });
  });

  describe("repayLoan", function () {
    let loanId: bigint;

    beforeEach(async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        lendingAddress,
        borrower.address,
        500_000n
      );
      const tx = await privateLending
        .connect(borrower)
        .requestLoan(testAssetId, handles[0], inputProof);
      const receipt = await tx.wait();
      const event = receipt?.logs.find((l: any) => l.fragment?.name === "LoanCreated");
      loanId = (event as any)?.args?.[0] ?? 0n;
    });

    it("should repay loan partially and update balance", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        lendingAddress,
        borrower.address,
        200_000n
      );
      const tx = await privateLending.connect(borrower).repayLoan(loanId, handles[0], inputProof);
      await tx.wait();

      // Loan should still be ACTIVE (partial repayment)
      const status = await privateLending.getLoanStatus(loanId);
      expect(status).to.equal(1); // ACTIVE
    });

    it("should reject repayment from non-borrower", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        lendingAddress,
        stranger.address,
        100_000n
      );
      await expect(
        privateLending.connect(stranger).repayLoan(loanId, handles[0], inputProof)
      ).to.be.revertedWith("PrivateLending: not borrower");
    });
  });

  describe("getLoanInfo / getBorrowerLoans", function () {
    it("should return correct loan info", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        lendingAddress,
        borrower.address,
        500_000n
      );
      await privateLending.connect(borrower).requestLoan(testAssetId, handles[0], inputProof);

      const info = await privateLending.getLoanInfo(0n);
      expect(info.assetId).to.equal(testAssetId);
      expect(info.borrower).to.equal(borrower.address);
      expect(info.status).to.equal(1); // ACTIVE
    });

    it("should return borrower loans list", async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        lendingAddress,
        borrower.address,
        500_000n
      );
      await privateLending.connect(borrower).requestLoan(testAssetId, handles[0], inputProof);

      const loans = await privateLending.getBorrowerLoans(borrower.address);
      expect(loans.length).to.equal(1);
      expect(loans[0]).to.equal(0n);
    });
  });

  describe("regulator access", function () {
    let loanId: bigint;

    beforeEach(async function () {
      const { handles, inputProof } = await encryptUint64(
        inst,
        lendingAddress,
        borrower.address,
        500_000n
      );
      const tx = await privateLending
        .connect(borrower)
        .requestLoan(testAssetId, handles[0], inputProof);
      const receipt = await tx.wait();
      const event = receipt?.logs.find((l: any) => l.fragment?.name === "LoanCreated");
      loanId = (event as any)?.args?.[0] ?? 0n;
    });

    it("should allow regulator to decrypt outstanding balance", async function () {
      const [, outstandingHandle] = await privateLending
        .connect(regulator)
        .getEncryptedLoanFields(loanId);
      expect(outstandingHandle).to.not.equal(0n);

      const outstanding = await reencryptAndDecrypt(
        inst,
        regulator,
        lendingAddress,
        outstandingHandle
      );
      expect(outstanding).to.be.greaterThan(0n);
    });

    it("should prevent public from decrypting loan details", async function () {
      await expect(
        privateLending.connect(stranger).getEncryptedLoanFields(loanId)
      ).to.be.revertedWith("PrivateLending: not authorized");
    });
  });
});

async function getBlockTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block?.timestamp ?? 0;
}
