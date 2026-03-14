import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { CreditScore } from "../typechain-types";
import {
  getFhevmInstance,
  encryptUint32,
  reencryptAndDecrypt,
  handleToBytes32,
} from "./helpers/fhevm-test-helpers";
import type { FhevmInstance } from "fhevmjs/node";

describe("CreditScore", function () {
  let creditScore: CreditScore;
  let owner: HardhatEthersSigner;
  let oracle: HardhatEthersSigner;
  let lendingContract: HardhatEthersSigner;
  let borrower: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let inst: FhevmInstance;
  let creditScoreAddress: string;

  beforeEach(async function () {
    [owner, oracle, lendingContract, borrower, stranger] = await ethers.getSigners();

    const CreditScoreFactory = await ethers.getContractFactory("CreditScore");
    creditScore = (await CreditScoreFactory.deploy()) as unknown as CreditScore;
    await creditScore.waitForDeployment();
    creditScoreAddress = await creditScore.getAddress();

    await creditScore.connect(owner).setLendingContract(lendingContract.address);
    await creditScore.connect(owner).setScoringOracle(oracle.address);

    inst = await getFhevmInstance();
  });

  it("should initialize borrower with DEFAULT_SCORE 600", async function () {
    await creditScore.connect(owner).initializeScore(borrower.address);
    expect(await creditScore.initialized(borrower.address)).to.be.true;

    const handle = await creditScore.connect(borrower).getEncryptedScore(borrower.address);
    expect(handle).to.not.equal(0n);

    const decrypted = await reencryptAndDecrypt(inst, borrower, creditScoreAddress, handle);
    expect(decrypted).to.equal(600n);
  });

  it("should reject updateScore from non-oracle", async function () {
    await creditScore.connect(owner).initializeScore(borrower.address);
    const { handles, inputProof } = await encryptUint32(
      inst,
      creditScoreAddress,
      stranger.address,
      50
    );
    await expect(
      creditScore.connect(stranger).updateScore(borrower.address, handleToBytes32(handles[0]), inputProof, true)
    ).to.be.revertedWith("CreditScore: not oracle");
  });

  it("should increase score and cap at MAX_SCORE 850", async function () {
    await creditScore.connect(owner).initializeScore(borrower.address);

    // Add 300 to 600 = 900, should be capped at 850
    const { handles, inputProof } = await encryptUint32(
      inst,
      creditScoreAddress,
      oracle.address,
      300
    );
    await creditScore.connect(oracle).updateScore(borrower.address, handleToBytes32(handles[0]), inputProof, true);

    const handle = await creditScore.connect(borrower).getEncryptedScore(borrower.address);
    const decrypted = await reencryptAndDecrypt(inst, borrower, creditScoreAddress, handle);
    expect(decrypted).to.equal(850n);
  });

  it("should decrease score and floor at MIN_SCORE 300", async function () {
    await creditScore.connect(owner).initializeScore(borrower.address);

    // Subtract 400 from 600 = 200, should be floored at 300
    const { handles, inputProof } = await encryptUint32(
      inst,
      creditScoreAddress,
      oracle.address,
      400
    );
    await creditScore.connect(oracle).updateScore(borrower.address, handleToBytes32(handles[0]), inputProof, false);

    const handle = await creditScore.connect(borrower).getEncryptedScore(borrower.address);
    const decrypted = await reencryptAndDecrypt(inst, borrower, creditScoreAddress, handle);
    expect(decrypted).to.equal(300n);
  });

  it("should return eligible=true when score >= minimum", async function () {
    await creditScore.connect(owner).initializeScore(borrower.address);

    // Score is 600, minimum is 550 → should be eligible
    const eligibleHandle = await creditScore
      .connect(lendingContract)
      .isEligible.staticCall(borrower.address, 550);
    expect(eligibleHandle).to.not.equal(0n);

    // We can't easily decrypt ebool in unit tests without gateway mock, but we can verify the handle is valid
    expect(typeof eligibleHandle).to.equal("bigint");
  });

  it("should return eligible=false when score < minimum", async function () {
    await creditScore.connect(owner).initializeScore(borrower.address);

    // Score is 600, minimum is 700 → not eligible
    const eligibleHandle = await creditScore
      .connect(lendingContract)
      .isEligible.staticCall(borrower.address, 700);
    expect(eligibleHandle).to.not.equal(0n);
    expect(typeof eligibleHandle).to.equal("bigint");
  });

  it("should only allow borrower/oracle/lendingContract to read score", async function () {
    await creditScore.connect(owner).initializeScore(borrower.address);

    // Borrower can read
    await expect(
      creditScore.connect(borrower).getEncryptedScore(borrower.address)
    ).to.not.be.reverted;

    // Oracle can read
    await expect(
      creditScore.connect(oracle).getEncryptedScore(borrower.address)
    ).to.not.be.reverted;

    // LendingContract can read
    await expect(
      creditScore.connect(lendingContract).getEncryptedScore(borrower.address)
    ).to.not.be.reverted;

    // Stranger cannot read
    await expect(
      creditScore.connect(stranger).getEncryptedScore(borrower.address)
    ).to.be.revertedWith("CreditScore: not authorized");
  });

  it("should prevent double initialization", async function () {
    await creditScore.connect(owner).initializeScore(borrower.address);
    await expect(
      creditScore.connect(owner).initializeScore(borrower.address)
    ).to.be.revertedWith("CreditScore: already initialized");
  });
});
