// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";
import "@fhevm/solidity/config/ZamaConfig.sol";
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
    ZamaEthereumConfig,
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

    mapping(uint256 => ebool) private _pendingRepaymentStatus;
    mapping(uint256 => ebool) private _pendingLiquidationDecision;

    address public regulator;

    uint32 public constant MINIMUM_CREDIT_SCORE = 550;
    uint64 public constant MAX_LTV_BPS = 7000;
    uint64 public constant LIQUIDATION_THRESHOLD_BPS = 8000;
    uint64 public constant SECONDS_PER_YEAR = 31536000;
    uint32 public defaultInterestRate = 500; // 5% in bps

    RWARegistry public rwaRegistry;
    CreditScore public creditScore;
    ConfidentialStablecoin public stablecoin;

    event RepaymentStatusRequested(uint256 indexed loanId, bytes32 indexed handle);
    event LiquidationDecisionRequested(uint256 indexed loanId, bytes32 indexed handle);

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
        externalEuint64 encryptedLoanAmount,
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
        euint64 loanAmount = FHE.fromExternal(encryptedLoanAmount, inputProof);

        // Locking first ensures the registry grants this contract ACL access to the collateral handle
        // before any encrypted computations use it.
        rwaRegistry.lockAsset(assetId, address(this));
        euint64 faceValue = rwaRegistry.getFaceValue(assetId);

        // Max loan = faceValue * MAX_LTV_BPS / 10000
        euint64 maxLoan = FHE.div(
            FHE.mul(faceValue, MAX_LTV_BPS),
            10000
        );

        ebool validAmount = FHE.le(loanAmount, maxLoan);
        ebool approved = FHE.and(eligible, validAmount);

        euint64 disbursement = FHE.select(approved, loanAmount, FHE.asEuint64(0));
        FHE.allow(disbursement, address(stablecoin));

        // Liquidation threshold = faceValue * LIQUIDATION_THRESHOLD_BPS / 10000
        euint64 liqThreshold = FHE.div(
            FHE.mul(faceValue, LIQUIDATION_THRESHOLD_BPS),
            10000
        );

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
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external override nonReentrant {
        Loan storage loan = _loans[loanId];
        require(loan.status == LoanStatus.ACTIVE, "PrivateLending: loan not active");
        require(loan.borrower == msg.sender, "PrivateLending: not borrower");

        _accrueInterest(loanId);

        euint64 repayAmount = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 actualRepay = FHE.min(repayAmount, loan.outstandingBalance);
        FHE.allow(actualRepay, address(stablecoin));

        loan.outstandingBalance = FHE.sub(loan.outstandingBalance, actualRepay);

        _allowLoanFields(loanId);

        // Transfer stablecoin from borrower to this contract
        stablecoin.transferEncrypted(msg.sender, address(this), actualRepay);

        ebool isFullyRepaid = FHE.eq(loan.outstandingBalance, FHE.asEuint64(0));
        _pendingRepaymentStatus[loanId] = FHE.makePubliclyDecryptable(isFullyRepaid);

        emit RepaymentStatusRequested(loanId, FHE.toBytes32(_pendingRepaymentStatus[loanId]));
    }

    /// @notice Finalize repayment after verifying the relayer public-decrypt proof for the repayment status.
    function finalizeRepayment(
        uint256 loanId,
        bytes calldata abiEncodedCleartexts,
        bytes calldata decryptionProof
    ) external nonReentrant {
        Loan storage loan = _loans[loanId];
        bytes32 pendingHandle = FHE.toBytes32(_pendingRepaymentStatus[loanId]);
        require(pendingHandle != bytes32(0), "PrivateLending: no pending repayment status");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = pendingHandle;
        FHE.checkSignatures(handles, abiEncodedCleartexts, decryptionProof);
        _pendingRepaymentStatus[loanId] = ebool.wrap(bytes32(0));

        bool fullyRepaid = abi.decode(abiEncodedCleartexts, (bool));
        if (fullyRepaid) {
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

        ebool shouldLiquidate = FHE.gt(loan.outstandingBalance, loan.liquidationThreshold);
        _pendingLiquidationDecision[loanId] = FHE.makePubliclyDecryptable(shouldLiquidate);

        emit LiquidationDecisionRequested(loanId, FHE.toBytes32(_pendingLiquidationDecision[loanId]));
    }

    /// @notice Finalize liquidation after verifying the relayer public-decrypt proof for the liquidation decision.
    function finalizeLiquidation(
        uint256 loanId,
        bytes calldata abiEncodedCleartexts,
        bytes calldata decryptionProof
    ) external nonReentrant {
        Loan storage loan = _loans[loanId];
        bytes32 pendingHandle = FHE.toBytes32(_pendingLiquidationDecision[loanId]);
        require(pendingHandle != bytes32(0), "PrivateLending: no pending liquidation decision");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = pendingHandle;
        FHE.checkSignatures(handles, abiEncodedCleartexts, decryptionProof);
        _pendingLiquidationDecision[loanId] = ebool.wrap(bytes32(0));

        bool shouldLiquidate = abi.decode(abiEncodedCleartexts, (bool));
        if (shouldLiquidate) {
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
        euint64 interest = FHE.div(
            FHE.mul(
                FHE.mul(loan.principal, uint64(loan.interestRatePerYear)),
                uint64(elapsed)
            ),
            denominator
        );

        loan.outstandingBalance = FHE.add(loan.outstandingBalance, interest);
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

    /// @notice Get the total number of loans ever created
    function totalLoans() external view returns (uint256) {
        return _nextLoanId;
    }

    function getPendingRepaymentStatusHandle(uint256 loanId) external view returns (bytes32) {
        return FHE.toBytes32(_pendingRepaymentStatus[loanId]);
    }

    function getPendingLiquidationDecisionHandle(uint256 loanId) external view returns (bytes32) {
        return FHE.toBytes32(_pendingLiquidationDecision[loanId]);
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

        FHE.allow(loan.principal, borrower);
        FHE.allow(loan.outstandingBalance, borrower);
        FHE.allow(loan.collateralValue, borrower);
        FHE.allow(loan.liquidationThreshold, borrower);

        FHE.allowThis(loan.principal);
        FHE.allowThis(loan.outstandingBalance);
        FHE.allowThis(loan.collateralValue);
        FHE.allowThis(loan.liquidationThreshold);

        if (regulator != address(0)) {
            FHE.allow(loan.principal, regulator);
            FHE.allow(loan.outstandingBalance, regulator);
            FHE.allow(loan.collateralValue, regulator);
            FHE.allow(loan.liquidationThreshold, regulator);
        }
    }
}
