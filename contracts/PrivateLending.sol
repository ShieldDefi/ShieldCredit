// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";
import "fhevm/config/ZamaGatewayConfig.sol";
import "fhevm/gateway/GatewayCaller.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IPrivateLending.sol";
import "./interfaces/IRWARegistry.sol";
import "./interfaces/ICreditScore.sol";
import "./ConfidentialStablecoin.sol";
import "./RWARegistry.sol";
import "./CreditScore.sol";

/// @title PrivateLending
/// @notice Confidential RWA-backed lending protocol with encrypted loan terms
contract PrivateLending is
    SepoliaZamaFHEVMConfig,
    SepoliaZamaGatewayConfig,
    GatewayCaller,
    Ownable,
    ReentrancyGuard,
    IPrivateLending
{
    struct Loan {
        euint64 principal;
        euint64 outstandingBalance;
        euint64 collateralValue;
        euint64 liquidationThreshold;
        uint256 assetId;
        address borrower;
        LoanStatus status;
        uint256 createdAt;
        uint256 lastAccrualAt;
        uint32 interestRatePerYear;
    }

    mapping(uint256 => Loan) private _loans;
    uint256 private _nextLoanId;
    mapping(address => uint256[]) public borrowerLoans;

    // Pending gateway callbacks
    mapping(uint256 => uint256) private _repayRequestToLoan;
    mapping(uint256 => uint256) private _liquidateRequestToLoan;

    address public regulator;

    uint32 public constant MINIMUM_CREDIT_SCORE = 550;
    uint64 public constant MAX_LTV_BPS = 7000;
    uint64 public constant LIQUIDATION_THRESHOLD_BPS = 8000;
    uint64 public constant SECONDS_PER_YEAR = 31536000;
    uint32 public defaultInterestRate = 500; // 5% in bps

    RWARegistry public rwaRegistry;
    CreditScore public creditScore;
    ConfidentialStablecoin public stablecoin;

    constructor(
        address _rwaRegistry,
        address _creditScore,
        address _stablecoin
    ) Ownable(msg.sender) {
        rwaRegistry = RWARegistry(_rwaRegistry);
        creditScore = CreditScore(_creditScore);
        stablecoin = ConfidentialStablecoin(_stablecoin);
    }

    /// @notice Set the regulator address with re-allow for all active loans
    function setRegulator(address _regulator) external override onlyOwner {
        regulator = _regulator;
        // Re-allow all active loan encrypted fields for the new regulator
        for (uint256 i = 0; i < _nextLoanId; i++) {
            if (_loans[i].status == LoanStatus.ACTIVE) {
                _allowLoanFields(i);
            }
        }
    }

    /// @notice Request a loan against a locked RWA asset
    function requestLoan(
        uint256 assetId,
        einput encryptedLoanAmount,
        bytes calldata inputProof
    ) external override nonReentrant returns (uint256 loanId) {
        require(
            rwaRegistry.getAssetOwner(assetId) == msg.sender,
            "PrivateLending: not asset owner"
        );
        require(!rwaRegistry.isLocked(assetId), "PrivateLending: asset already locked");

        // Initialize credit score if needed
        if (!creditScore.initialized(msg.sender)) {
            creditScore.initializeScore(msg.sender);
        }

        ebool eligible = creditScore.isEligible(msg.sender, MINIMUM_CREDIT_SCORE);
        euint64 faceValue = rwaRegistry.getFaceValue(assetId);
        euint64 loanAmount = TFHE.asEuint64(encryptedLoanAmount, inputProof);

        // Max loan = faceValue * MAX_LTV_BPS / 10000
        euint64 maxLoan = TFHE.div(
            TFHE.mul(faceValue, MAX_LTV_BPS),
            10000
        );

        ebool validAmount = TFHE.le(loanAmount, maxLoan);
        ebool approved = TFHE.and(eligible, validAmount);

        euint64 disbursement = TFHE.select(approved, loanAmount, TFHE.asEuint64(0));

        // Liquidation threshold = faceValue * LIQUIDATION_THRESHOLD_BPS / 10000
        euint64 liqThreshold = TFHE.div(
            TFHE.mul(faceValue, LIQUIDATION_THRESHOLD_BPS),
            10000
        );

        // Lock collateral
        rwaRegistry.lockAsset(assetId, address(this));

        loanId = _nextLoanId++;
        _loans[loanId] = Loan({
            principal: disbursement,
            outstandingBalance: disbursement,
            collateralValue: faceValue,
            liquidationThreshold: liqThreshold,
            assetId: assetId,
            borrower: msg.sender,
            status: LoanStatus.ACTIVE,
            createdAt: block.timestamp,
            lastAccrualAt: block.timestamp,
            interestRatePerYear: defaultInterestRate
        });

        borrowerLoans[msg.sender].push(loanId);

        _allowLoanFields(loanId);

        // Mint stablecoin to borrower
        stablecoin.mint(msg.sender, disbursement);

        emit LoanCreated(loanId, msg.sender, assetId);
        return loanId;
    }

    /// @notice Repay a loan (partially or fully)
    function repayLoan(
        uint256 loanId,
        einput encryptedAmount,
        bytes calldata inputProof
    ) external override nonReentrant {
        Loan storage loan = _loans[loanId];
        require(loan.status == LoanStatus.ACTIVE, "PrivateLending: loan not active");
        require(loan.borrower == msg.sender, "PrivateLending: not borrower");

        _accrueInterest(loanId);

        euint64 repayAmount = TFHE.asEuint64(encryptedAmount, inputProof);
        euint64 actualRepay = TFHE.min(repayAmount, loan.outstandingBalance);

        loan.outstandingBalance = TFHE.sub(loan.outstandingBalance, actualRepay);

        _allowLoanFields(loanId);

        // Transfer stablecoin from borrower to this contract
        stablecoin.transferEncrypted(msg.sender, address(this), actualRepay);

        // Request decryption to check if fully repaid
        ebool isFullyRepaid = TFHE.eq(loan.outstandingBalance, TFHE.asEuint64(0));
        TFHE.allowThis(isFullyRepaid);

        uint256[] memory handles = new uint256[](1);
        handles[0] = Gateway.toUint256(isFullyRepaid);

        uint256 requestId = Gateway.requestDecryption(
            handles,
            this.callbackRepay.selector,
            0,
            block.timestamp + 100,
            false
        );
        _repayRequestToLoan[requestId] = loanId;
    }

    /// @notice Gateway callback for repayment — marks loan as REPAID if balance is zero
    function callbackRepay(
        uint256 requestId,
        bool fullyRepaid,
        bytes[] memory /*signatures*/
    ) external {
        require(msg.sender == Gateway.gatewayContractAddress(), "PrivateLending: invalid gateway");
        uint256 loanId = _repayRequestToLoan[requestId];
        delete _repayRequestToLoan[requestId];

        if (fullyRepaid) {
            Loan storage loan = _loans[loanId];
            loan.status = LoanStatus.REPAID;
            rwaRegistry.unlockAsset(loan.assetId);
            emit LoanRepaid(loanId, loan.borrower);
        }
    }

    /// @notice Check if a loan should be liquidated based on outstanding balance vs threshold
    function checkAndLiquidate(uint256 loanId) external override nonReentrant {
        Loan storage loan = _loans[loanId];
        require(loan.status == LoanStatus.ACTIVE, "PrivateLending: loan not active");

        _accrueInterest(loanId);

        ebool shouldLiquidate = TFHE.gt(loan.outstandingBalance, loan.liquidationThreshold);
        TFHE.allowThis(shouldLiquidate);

        uint256[] memory handles = new uint256[](1);
        handles[0] = Gateway.toUint256(shouldLiquidate);

        uint256 requestId = Gateway.requestDecryption(
            handles,
            this.callbackLiquidate.selector,
            0,
            block.timestamp + 100,
            false
        );
        _liquidateRequestToLoan[requestId] = loanId;
    }

    /// @notice Gateway callback for liquidation
    function callbackLiquidate(
        uint256 requestId,
        bool shouldLiquidate,
        bytes[] memory /*signatures*/
    ) external {
        require(msg.sender == Gateway.gatewayContractAddress(), "PrivateLending: invalid gateway");
        uint256 loanId = _liquidateRequestToLoan[requestId];
        delete _liquidateRequestToLoan[requestId];

        if (shouldLiquidate) {
            Loan storage loan = _loans[loanId];
            address borrower = loan.borrower;
            loan.status = LoanStatus.LIQUIDATED;

            // liquidationTransfer atomically unlocks and transfers ownership to this contract
            rwaRegistry.liquidationTransfer(loan.assetId, address(this));

            // Penalize credit score via the lending-contract privileged path
            creditScore.penalizeScore(borrower, 50);

            emit LoanLiquidated(loanId, borrower);
        }
    }

    /// @notice Accrue interest on a loan since last accrual
    function _accrueInterest(uint256 loanId) internal {
        Loan storage loan = _loans[loanId];
        if (loan.status != LoanStatus.ACTIVE) return;

        uint256 elapsed = block.timestamp - loan.lastAccrualAt;
        if (elapsed == 0) return;

        // interest = principal * rate * elapsed / (SECONDS_PER_YEAR * 10000)
        uint64 denominator = uint64(SECONDS_PER_YEAR) * 10000;
        euint64 interest = TFHE.div(
            TFHE.mul(
                TFHE.mul(loan.principal, uint64(loan.interestRatePerYear)),
                uint64(elapsed)
            ),
            denominator
        );

        loan.outstandingBalance = TFHE.add(loan.outstandingBalance, interest);
        loan.lastAccrualAt = block.timestamp;

        _allowLoanFields(loanId);
        emit InterestAccrued(loanId, block.timestamp);
    }

    /// @notice Public wrapper to accrue interest on a loan
    function accrueInterest(uint256 loanId) external nonReentrant {
        require(_loans[loanId].status == LoanStatus.ACTIVE, "PrivateLending: loan not active");
        _accrueInterest(loanId);
    }

    /// @notice Get the status of a loan
    function getLoanStatus(uint256 loanId) external view override returns (LoanStatus) {
        return _loans[loanId].status;
    }

    /// @notice Get all loan IDs for a borrower
    function getBorrowerLoans(address borrower) external view override returns (uint256[] memory) {
        return borrowerLoans[borrower];
    }

    /// @notice Get public loan metadata (no encrypted fields)
    function getLoanInfo(uint256 loanId)
        external
        view
        returns (
            uint256 assetId,
            address borrower,
            LoanStatus status,
            uint256 createdAt,
            uint256 lastAccrualAt,
            uint32 interestRatePerYear
        )
    {
        Loan storage loan = _loans[loanId];
        return (
            loan.assetId,
            loan.borrower,
            loan.status,
            loan.createdAt,
            loan.lastAccrualAt,
            loan.interestRatePerYear
        );
    }

    /// @notice Get encrypted loan fields (only borrower or regulator)
    function getEncryptedLoanFields(uint256 loanId)
        external
        view
        returns (
            euint64 principal,
            euint64 outstandingBalance,
            euint64 collateralValue,
            euint64 liquidationThreshold
        )
    {
        Loan storage loan = _loans[loanId];
        require(
            msg.sender == loan.borrower || msg.sender == regulator,
            "PrivateLending: not authorized"
        );
        return (
            loan.principal,
            loan.outstandingBalance,
            loan.collateralValue,
            loan.liquidationThreshold
        );
    }

    /// @dev Re-allow all encrypted fields for borrower, regulator, and this contract
    function _allowLoanFields(uint256 loanId) internal {
        Loan storage loan = _loans[loanId];
        address borrower = loan.borrower;

        TFHE.allow(loan.principal, borrower);
        TFHE.allow(loan.outstandingBalance, borrower);
        TFHE.allow(loan.collateralValue, borrower);
        TFHE.allow(loan.liquidationThreshold, borrower);

        TFHE.allowThis(loan.principal);
        TFHE.allowThis(loan.outstandingBalance);
        TFHE.allowThis(loan.collateralValue);
        TFHE.allowThis(loan.liquidationThreshold);

        if (regulator != address(0)) {
            TFHE.allow(loan.principal, regulator);
            TFHE.allow(loan.outstandingBalance, regulator);
            TFHE.allow(loan.collateralValue, regulator);
            TFHE.allow(loan.liquidationThreshold, regulator);
        }
    }
}
