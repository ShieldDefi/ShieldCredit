// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";
import "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ConfidentialStablecoin
/// @notice ERC-20-style stablecoin with fully encrypted balances using Zama fhEVM
contract ConfidentialStablecoin is ZamaEthereumConfig, Ownable, ReentrancyGuard {
    string public constant name = "Shield USD";
    string public constant symbol = "sUSD";
    uint8 public constant decimals = 6;

    mapping(address => euint64) private _balances;
    euint64 private _totalSupply;

    address public lendingContract;
    mapping(address => bool) public authorizedMinters;

    event Transfer(address indexed from, address indexed to);
    event Mint(address indexed to);
    event LendingContractUpdated(address indexed newLendingContract);
    event AuthorizedMinterUpdated(address indexed minter, bool allowed);

    modifier onlyMinter() {
        require(
            msg.sender == owner() || authorizedMinters[msg.sender],
            "ConfidentialStablecoin: not authorized to mint"
        );
        _;
    }

    constructor() Ownable(msg.sender) {
        _totalSupply = FHE.asEuint64(0);
        FHE.allowThis(_totalSupply);
        FHE.allow(_totalSupply, msg.sender);
    }

    /// @notice Allow the lending contract to mint stablecoins
    function allowLendingContract(address _lendingContract) external onlyOwner {
        require(_lendingContract != address(0), "ConfidentialStablecoin: zero address");

        if (lendingContract != address(0) && lendingContract != _lendingContract) {
            authorizedMinters[lendingContract] = false;
            emit AuthorizedMinterUpdated(lendingContract, false);
        }

        lendingContract = _lendingContract;
        authorizedMinters[_lendingContract] = true;

        emit AuthorizedMinterUpdated(_lendingContract, true);
        emit LendingContractUpdated(_lendingContract);
    }

    /// @notice Allow or revoke additional minters such as a testnet faucet
    function setAuthorizedMinter(address minter, bool allowed) external onlyOwner {
        require(minter != address(0), "ConfidentialStablecoin: zero address");
        authorizedMinters[minter] = allowed;
        emit AuthorizedMinterUpdated(minter, allowed);
    }

    /// @notice Internal mint — adds encrypted amount to recipient balance
    function _mintInternal(address to, euint64 amount) internal {
        euint64 prevBalance = _balances[to];
        _balances[to] = FHE.add(prevBalance, amount);
        _totalSupply = FHE.add(_totalSupply, amount);
        _allowBalance(to);
        FHE.allowThis(_totalSupply);
        FHE.allow(_totalSupply, owner());
        emit Mint(to);
    }

    /// @notice Mint stablecoins by passing a pre-constructed euint64 handle (only minter)
    function mint(address to, euint64 amount) external onlyMinter {
        _mintInternal(to, amount);
    }

    /// @notice Mint stablecoins from encrypted bytes (only minter)
    function mint(
        address to,
        externalEuint64 inputHandle,
        bytes calldata inputProof
    ) external onlyMinter {
        euint64 amount = FHE.fromExternal(inputHandle, inputProof);
        _mintInternal(to, amount);
    }

    /// @notice Transfer stablecoins — amount verified to not exceed balance using TFHE.select
    function transfer(
        address to,
        externalEuint64 inputHandle,
        bytes calldata inputProof
    ) external nonReentrant {
        euint64 amount = FHE.fromExternal(inputHandle, inputProof);
        ebool canTransfer = FHE.le(amount, _balances[msg.sender]);
        euint64 actualAmount = FHE.select(canTransfer, amount, FHE.asEuint64(0));

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], actualAmount);
        _balances[to] = FHE.add(_balances[to], actualAmount);

        _allowBalance(msg.sender);
        _allowBalance(to);
        emit Transfer(msg.sender, to);
    }

    /// @notice Transfer an already-encrypted euint64 handle between addresses (internal, used by lending)
    function transferEncrypted(
        address from,
        address to,
        euint64 amount
    ) external nonReentrant {
        require(msg.sender == lendingContract, "ConfidentialStablecoin: only lending contract");
        ebool canTransfer = FHE.le(amount, _balances[from]);
        euint64 actualAmount = FHE.select(canTransfer, amount, FHE.asEuint64(0));

        _balances[from] = FHE.sub(_balances[from], actualAmount);
        _balances[to] = FHE.add(_balances[to], actualAmount);

        _allowBalance(from);
        _allowBalance(to);
        emit Transfer(from, to);
    }

    /// @notice Returns the encrypted balance handle for a given address
    function balanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }

    /// @notice Returns the encrypted total supply handle
    function totalSupply() external view returns (euint64) {
        return _totalSupply;
    }

    /// @dev Re-allow balance handle for owner, contract, and lending contract
    function _allowBalance(address addr) internal {
        FHE.allow(_balances[addr], addr);
        FHE.allowThis(_balances[addr]);
        if (lendingContract != address(0)) {
            FHE.allow(_balances[addr], lendingContract);
        }
    }
}
