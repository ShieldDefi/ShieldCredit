// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";

interface IRWARegistry {
    enum AssetType {
        TREASURY_BOND,
        INVOICE,
        REAL_ESTATE,
        EQUITY
    }

    event AssetRegistered(uint256 indexed assetId, address indexed owner, AssetType assetType);
    event AssetTransferred(uint256 indexed assetId, address indexed from, address indexed to);
    event AssetLocked(uint256 indexed assetId, address indexed lendingContract);
    event AssetUnlocked(uint256 indexed assetId);

    function registerAsset(
        einput encryptedFaceValue,
        bytes calldata inputProof,
        AssetType assetType,
        string calldata metadataURI
    ) external returns (uint256 assetId);

    function transferAsset(uint256 assetId, address newOwner) external;

    function lockAsset(uint256 assetId, address lendingContract) external;

    function unlockAsset(uint256 assetId) external;

    function getFaceValue(uint256 assetId) external view returns (euint64);

    function getAssetOwner(uint256 assetId) external view returns (address);

    function isLocked(uint256 assetId) external view returns (bool);

    function whitelistIssuer(address issuer) external;

    function setAuditor(address auditor) external;
}
