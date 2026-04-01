// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ConfidentialStablecoin.sol";

/// @title TestStablecoinFaucet
/// @notice Public testnet faucet that forwards encrypted mint requests to the stablecoin
contract TestStablecoinFaucet {
    ConfidentialStablecoin public immutable stablecoin;

    event FaucetMint(address indexed caller, address indexed recipient);

    constructor(address stablecoinAddress) {
        require(stablecoinAddress != address(0), "TestStablecoinFaucet: zero address");
        stablecoin = ConfidentialStablecoin(stablecoinAddress);
    }

    function mintToSelf(
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external {
        stablecoin.mint(msg.sender, encryptedAmount, inputProof);
        emit FaucetMint(msg.sender, msg.sender);
    }

    function mint(
        address recipient,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external {
        require(recipient != address(0), "TestStablecoinFaucet: zero address");
        stablecoin.mint(recipient, encryptedAmount, inputProof);
        emit FaucetMint(msg.sender, recipient);
    }
}
