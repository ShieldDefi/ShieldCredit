// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";
import "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IRWARegistry.sol";

/// @title RWARegistry
/// @notice Registry for Real-World Assets with encrypted face values
contract RWARegistry is ZamaEthereumConfig, Ownable, ReentrancyGuard, IRWARegistry {
    struct Asset {
        euint64 faceValue;
        AssetType assetType;
        address owner;
        bool locked;
        address lockedBy;
        string metadataURI;
        uint256 registeredAt;
    }

    mapping(uint256 => Asset) private _assets;
    uint256 private _nextAssetId;
    mapping(address => bool) public whitelistedIssuers;
    address public auditor;
    address public lendingContract;
    mapping(address => uint256[]) public issuerAssets;

    // Track all asset IDs for re-allow on auditor change
    uint256[] private _allAssetIds;

    constructor() Ownable(msg.sender) {}

    /// @notice Whitelist an issuer to register assets
    function whitelistIssuer(address issuer) external override onlyOwner {
        whitelistedIssuers[issuer] = true;
    }

    /// @notice Set the auditor address and re-allow all existing asset face values
    function setAuditor(address _auditor) external override onlyOwner {
        auditor = _auditor;
        uint256 total = _allAssetIds.length;
        uint256 limit = total > 100 ? 100 : total;
        for (uint256 i = 0; i < limit; i++) {
            uint256 assetId = _allAssetIds[total - limit + i];
            FHE.allow(_assets[assetId].faceValue, _auditor);
        }
    }

    /// @notice Set the authorized lending contract used for loan origination
    function setLendingContract(address _lendingContract) external override onlyOwner {
        require(_lendingContract != address(0), "RWARegistry: zero address");
        lendingContract = _lendingContract;

        uint256 total = _allAssetIds.length;
        uint256 limit = total > 100 ? 100 : total;
        for (uint256 i = 0; i < limit; i++) {
            uint256 assetId = _allAssetIds[total - limit + i];
            FHE.allow(_assets[assetId].faceValue, _lendingContract);
        }
    }

    /// @notice Register a new RWA with an encrypted face value
    function registerAsset(
        externalEuint64 encryptedFaceValue,
        bytes calldata inputProof,
        AssetType assetType,
        string calldata metadataURI
    ) external override nonReentrant returns (uint256 assetId) {
        require(whitelistedIssuers[msg.sender], "RWARegistry: issuer not whitelisted");

        euint64 faceValue = FHE.fromExternal(encryptedFaceValue, inputProof);
        require(FHE.isInitialized(faceValue), "RWARegistry: invalid face value");

        // Allow access for owner, auditor, and this contract
        FHE.allow(faceValue, msg.sender);
        FHE.allowThis(faceValue);
        if (auditor != address(0)) {
            FHE.allow(faceValue, auditor);
        }
        if (lendingContract != address(0)) {
            FHE.allow(faceValue, lendingContract);
        }

        assetId = _nextAssetId++;
        _assets[assetId] = Asset({
            faceValue: faceValue,
            assetType: assetType,
            owner: msg.sender,
            locked: false,
            lockedBy: address(0),
            metadataURI: metadataURI,
            registeredAt: block.timestamp
        });

        issuerAssets[msg.sender].push(assetId);
        _allAssetIds.push(assetId);

        emit AssetRegistered(assetId, msg.sender, assetType);
        return assetId;
    }

    /// @notice Transfer asset ownership (only owner, must not be locked)
    function transferAsset(uint256 assetId, address newOwner) external override nonReentrant {
        Asset storage asset = _assets[assetId];
        require(asset.owner == msg.sender, "RWARegistry: not asset owner");
        require(!asset.locked, "RWARegistry: asset is locked");
        require(newOwner != address(0), "RWARegistry: zero address");

        address previousOwner = asset.owner;
        asset.owner = newOwner;

        FHE.allow(asset.faceValue, newOwner);
        FHE.allowThis(asset.faceValue);
        if (auditor != address(0)) {
            FHE.allow(asset.faceValue, auditor);
        }
        if (lendingContract != address(0)) {
            FHE.allow(asset.faceValue, lendingContract);
        }

        emit AssetTransferred(assetId, previousOwner, newOwner);
    }

    /// @notice Transfer asset after liquidation — can only be called by the locker (lending contract)
    /// @dev Used during liquidation to take custody of collateral without requiring borrower signature
    function liquidationTransfer(uint256 assetId, address newOwner) external nonReentrant {
        Asset storage asset = _assets[assetId];
        require(asset.lockedBy == msg.sender, "RWARegistry: only locker can liquidation-transfer");
        require(asset.locked, "RWARegistry: asset not locked");
        require(newOwner != address(0), "RWARegistry: zero address");

        address previousOwner = asset.owner;
        asset.owner = newOwner;
        asset.locked = false;
        asset.lockedBy = address(0);

        FHE.allow(asset.faceValue, newOwner);
        FHE.allowThis(asset.faceValue);
        if (auditor != address(0)) {
            FHE.allow(asset.faceValue, auditor);
        }
        if (lendingContract != address(0)) {
            FHE.allow(asset.faceValue, lendingContract);
        }

        emit AssetTransferred(assetId, previousOwner, newOwner);
    }


    function lockAsset(uint256 assetId, address _lendingContract) external override nonReentrant {
        Asset storage asset = _assets[assetId];
        require(
            msg.sender == asset.owner || msg.sender == lendingContract,
            "RWARegistry: not authorized to lock"
        );
        require(!asset.locked, "RWARegistry: already locked");
        require(_lendingContract != address(0), "RWARegistry: zero address");
        require(_lendingContract == lendingContract, "RWARegistry: unsupported lending contract");

        asset.locked = true;
        asset.lockedBy = _lendingContract;

        FHE.allow(asset.faceValue, _lendingContract);

        emit AssetLocked(assetId, _lendingContract);
    }

    /// @notice Unlock an asset (only the contract that locked it)
    function unlockAsset(uint256 assetId) external override nonReentrant {
        Asset storage asset = _assets[assetId];
        require(asset.lockedBy == msg.sender, "RWARegistry: not the locker");
        require(asset.locked, "RWARegistry: not locked");

        asset.locked = false;
        asset.lockedBy = address(0);

        emit AssetUnlocked(assetId);
    }

    /// @notice Get the encrypted face value (only lending contract, auditor, or owner)
    function getFaceValue(uint256 assetId) external view override returns (euint64) {
        Asset storage asset = _assets[assetId];
        require(
            msg.sender == asset.owner ||
            msg.sender == auditor ||
            msg.sender == asset.lockedBy ||
            msg.sender == lendingContract,
            "RWARegistry: not authorized"
        );
        return asset.faceValue;
    }

    /// @notice Get the owner of an asset
    function getAssetOwner(uint256 assetId) external view override returns (address) {
        return _assets[assetId].owner;
    }

    /// @notice Check if an asset is locked
    function isLocked(uint256 assetId) external view override returns (bool) {
        return _assets[assetId].locked;
    }

    /// @notice Get the full asset struct (public metadata only)
    function getAsset(uint256 assetId)
        external
        view
        returns (
            AssetType assetType,
            address assetOwner,
            bool locked,
            address lockedBy,
            string memory metadataURI,
            uint256 registeredAt
        )
    {
        Asset storage asset = _assets[assetId];
        return (
            asset.assetType,
            asset.owner,
            asset.locked,
            asset.lockedBy,
            asset.metadataURI,
            asset.registeredAt
        );
    }

    /// @notice Get the count of registered assets
    function totalAssets() external view returns (uint256) {
        return _nextAssetId;
    }
}
