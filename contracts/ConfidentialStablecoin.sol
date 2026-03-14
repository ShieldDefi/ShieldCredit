// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";
import "fhevm/config/ZamaGatewayConfig.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ConfidentialStablecoin
/// @notice ERC-20-style stablecoin with fully encrypted balances using Zama fhEVM
contract ConfidentialStablecoin is SepoliaZamaFHEVMConfig, SepoliaZamaGatewayConfig, Ownable, ReentrancyGuard {
    string public constant name = "Shield USD";
    string public constant symbol = "sUSD";
    uint8 public constant decimals = 6;

    mapping(address => euint64) private _balances;
    euint64 private _totalSupply;

    address public lendingContract;

    event Transfer(address indexed from, address indexed to);
    event Mint(address indexed to);
    event LendingContractUpdated(address indexed newLendingContract);

    modifier onlyMinter() {
        require(msg.sender == owner() || msg.sender == lendingContract, "ConfidentialStablecoin: not authorized to mint");
        _;
    }

    constructor() Ownable(msg.sender) {
        _totalSupply = TFHE.asEuint64(0);
        TFHE.allowThis(_totalSupply);
        TFHE.allow(_totalSupply, msg.sender);
    }

    /// @notice Allow the lending contract to mint stablecoins
    function allowLendingContract(address _lendingContract) external onlyOwner {
        lendingContract = _lendingContract;
        emit LendingContractUpdated(_lendingContract);
    }

    /// @notice Internal mint — adds encrypted amount to recipient balance
    function _mintInternal(address to, euint64 amount) internal {
        euint64 prevBalance = _balances[to];
        _balances[to] = TFHE.add(prevBalance, amount);
        _totalSupply = TFHE.add(_totalSupply, amount);
        _allowBalance(to);
        TFHE.allowThis(_totalSupply);
        TFHE.allow(_totalSupply, owner());
        emit Mint(to);
    }

    /// @notice Mint stablecoins by passing a pre-constructed euint64 handle (only minter)
    function mint(address to, euint64 amount) external onlyMinter {
        _mintInternal(to, amount);
    }

    /// @notice Mint stablecoins from encrypted bytes (only minter)
    function mint(
        address to,
        einput inputHandle,
        bytes calldata inputProof
    ) external onlyMinter {
        euint64 amount = TFHE.asEuint64(inputHandle, inputProof);
        _mintInternal(to, amount);
    }

    /// @notice Transfer stablecoins — amount verified to not exceed balance using TFHE.select
    function transfer(
        address to,
        einput inputHandle,
        bytes calldata inputProof
    ) external nonReentrant {
        euint64 amount = TFHE.asEuint64(inputHandle, inputProof);
        ebool canTransfer = TFHE.le(amount, _balances[msg.sender]);
        euint64 actualAmount = TFHE.select(canTransfer, amount, TFHE.asEuint64(0));

        _balances[msg.sender] = TFHE.sub(_balances[msg.sender], actualAmount);
        _balances[to] = TFHE.add(_balances[to], actualAmount);

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
        ebool canTransfer = TFHE.le(amount, _balances[from]);
        euint64 actualAmount = TFHE.select(canTransfer, amount, TFHE.asEuint64(0));

        _balances[from] = TFHE.sub(_balances[from], actualAmount);
        _balances[to] = TFHE.add(_balances[to], actualAmount);

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
        TFHE.allow(_balances[addr], addr);
        TFHE.allowThis(_balances[addr]);
        if (lendingContract != address(0)) {
            TFHE.allow(_balances[addr], lendingContract);
        }
    }
}
