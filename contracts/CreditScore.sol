// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";
import "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ICreditScore.sol";

/// @title CreditScore
/// @notice Manages confidential credit scores for borrowers using fhEVM
contract CreditScore is ZamaEthereumConfig, Ownable, ReentrancyGuard, ICreditScore {
    mapping(address => euint32) private _scores;
    mapping(address => bool) public initialized;

    address public scoringOracle;
    address public lendingContract;

    uint32 public constant MIN_SCORE = 300;
    uint32 public constant MAX_SCORE = 850;
    uint32 public constant DEFAULT_SCORE = 600;

    constructor() Ownable(msg.sender) {}

    /// @notice Set the lending contract address
    function setLendingContract(address _lendingContract) external override onlyOwner {
        lendingContract = _lendingContract;
    }

    /// @notice Set the scoring oracle address
    function setScoringOracle(address oracle) external override onlyOwner {
        scoringOracle = oracle;
    }

    /// @notice Initialize a borrower's credit score to DEFAULT_SCORE
    function initializeScore(address borrower) external override {
        require(
            msg.sender == owner() || msg.sender == lendingContract,
            "CreditScore: not authorized"
        );
        require(!initialized[borrower], "CreditScore: already initialized");

        euint32 score = FHE.asEuint32(DEFAULT_SCORE);
        _scores[borrower] = score;
        initialized[borrower] = true;

        _allowScore(borrower);

        emit ScoreInitialized(borrower);
    }

    /// @notice Update a borrower's credit score (only oracle)
    function updateScore(
        address borrower,
        externalEuint32 encryptedDelta,
        bytes calldata inputProof,
        bool positive
    ) external override nonReentrant {
        require(msg.sender == scoringOracle, "CreditScore: not oracle");
        require(initialized[borrower], "CreditScore: score not initialized");

        euint32 delta = FHE.fromExternal(encryptedDelta, inputProof);
        euint32 current = _scores[borrower];

        euint32 updated;
        if (positive) {
            euint32 added = FHE.add(current, delta);
            updated = FHE.min(added, FHE.asEuint32(MAX_SCORE));
        } else {
            // Use FHE.select to avoid underflow: if delta > current, clamp to MIN_SCORE.
            ebool underflows = FHE.gt(delta, current);
            euint32 subtracted = FHE.sub(current, delta);
            euint32 safeResult = FHE.max(subtracted, FHE.asEuint32(MIN_SCORE));
            updated = FHE.select(underflows, FHE.asEuint32(MIN_SCORE), safeResult);
        }

        _scores[borrower] = updated;
        _allowScore(borrower);

        emit ScoreUpdated(borrower, positive);
    }

    /// @notice Penalize a borrower's score by a plaintext amount (only lending contract, on liquidation)
    /// @dev Uses plaintext delta to avoid requiring oracle signature in liquidation path
    function penalizeScore(address borrower, uint32 penaltyPoints) external {
        require(msg.sender == lendingContract, "CreditScore: only lending contract");
        require(initialized[borrower], "CreditScore: not initialized");

        euint32 penalty = FHE.asEuint32(penaltyPoints);
        euint32 subtracted = FHE.sub(_scores[borrower], penalty);
        _scores[borrower] = FHE.max(subtracted, FHE.asEuint32(MIN_SCORE));
        _allowScore(borrower);

        emit ScoreUpdated(borrower, false);
    }

    /// @notice Check whether a borrower's score meets a minimum threshold
    function isEligible(address borrower, uint32 minimum) external override returns (ebool) {
        require(initialized[borrower], "CreditScore: not initialized");
        ebool eligible = FHE.ge(_scores[borrower], FHE.asEuint32(minimum));
        FHE.allow(eligible, lendingContract);
        FHE.allowThis(eligible);
        return eligible;
    }

    /// @notice Get the encrypted score handle (only borrower, oracle, or lending contract)
    function getEncryptedScore(address borrower) external view override returns (euint32) {
        require(
            msg.sender == borrower ||
            msg.sender == scoringOracle ||
            msg.sender == lendingContract,
            "CreditScore: not authorized"
        );
        return _scores[borrower];
    }

    /// @dev Re-allow score handle for borrower, lending contract, oracle, and this contract
    function _allowScore(address borrower) internal {
        FHE.allow(_scores[borrower], borrower);
        FHE.allowThis(_scores[borrower]);
        if (lendingContract != address(0)) {
            FHE.allow(_scores[borrower], lendingContract);
        }
        if (scoringOracle != address(0)) {
            FHE.allow(_scores[borrower], scoringOracle);
        }
    }
}
