// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";

interface IPrivateLending {
    enum LoanStatus {
        NONE,
        ACTIVE,
        REPAID,
        LIQUIDATED
    }

    event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 indexed assetId);
    event LoanRepaid(uint256 indexed loanId, address indexed borrower);
    event LoanLiquidated(uint256 indexed loanId, address indexed borrower);
    event InterestAccrued(uint256 indexed loanId, uint256 timestamp);

    function requestLoan(
        uint256 assetId,
        externalEuint64 encryptedLoanAmount,
        bytes calldata inputProof
    ) external returns (uint256 loanId);

    function repayLoan(
        uint256 loanId,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external;

    function checkAndLiquidate(uint256 loanId) external;

    function getLoanStatus(uint256 loanId) external view returns (LoanStatus);

    function getBorrowerLoans(address borrower) external view returns (uint256[] memory);

    function setRegulator(address regulator) external;
}
