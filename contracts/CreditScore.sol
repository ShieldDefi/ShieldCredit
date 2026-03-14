// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";
import "fhevm/config/ZamaGatewayConfig.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ICreditScore.sol";

/// @title CreditScore
/// @notice Manages confidential credit scores for borrowers using fhEVM
contract CreditScore is SepoliaZamaFHEVMConfig, SepoliaZamaGatewayConfig, Ownable, ReentrancyGuard, ICreditScore {
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

        euint32 score = TFHE.asEuint32(DEFAULT_SCORE);
        _scores[borrower] = score;
        initialized[borrower] = true;

        _allowScore(borrower);

        emit ScoreInitialized(borrower);
    }

    /// @notice Update a borrower's credit score (only oracle)
    function updateScore(
        address borrower,
        einput encryptedDelta,
        bytes calldata inputProof,
        bool positive
    ) external override nonReentrant {
        require(msg.sender == scoringOracle, "CreditScore: not oracle");
        require(initialized[borrower], "CreditScore: score not initialized");

        euint32 delta = TFHE.asEuint32(encryptedDelta, inputProof);
        euint32 current = _scores[borrower];

        euint32 updated;
        if (positive) {
            euint32 added = TFHE.add(current, delta);
            updated = TFHE.min(added, TFHE.asEuint32(MAX_SCORE));
        } else {
            // Protect against underflow: if current < delta, result should be MIN_SCORE
            euint32 subtracted = TFHE.sub(current, delta);
            updated = TFHE.max(subtracted, TFHE.asEuint32(MIN_SCORE));
        }

        _scores[borrower] = updated;
        _allowScore(borrower);

        emit ScoreUpdated(borrower, positive);
    }

    /// @notice Check whether a borrower's score meets a minimum threshold
    function isEligible(address borrower, uint32 minimum) external override returns (ebool) {
        require(initialized[borrower], "CreditScore: not initialized");
        ebool eligible = TFHE.ge(_scores[borrower], TFHE.asEuint32(minimum));
        TFHE.allow(eligible, lendingContract);
        TFHE.allowThis(eligible);
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
        TFHE.allow(_scores[borrower], borrower);
        TFHE.allowThis(_scores[borrower]);
        if (lendingContract != address(0)) {
            TFHE.allow(_scores[borrower], lendingContract);
        }
        if (scoringOracle != address(0)) {
            TFHE.allow(_scores[borrower], scoringOracle);
        }
    }
}
