// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";

interface ICreditScore {
    event ScoreInitialized(address indexed borrower);
    event ScoreUpdated(address indexed borrower, bool positive);

    function initializeScore(address borrower) external;

    function updateScore(
        address borrower,
        externalEuint32 encryptedDelta,
        bytes calldata inputProof,
        bool positive
    ) external;

    function isEligible(address borrower, uint32 minimum) external returns (ebool);

    function getEncryptedScore(address borrower) external view returns (euint32);

    function setLendingContract(address lendingContract) external;

    function setScoringOracle(address oracle) external;
}
