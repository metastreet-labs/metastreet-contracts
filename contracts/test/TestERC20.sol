// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetFixedSupply.sol";

/**
 * @title Test ERC20 Token
 */
contract TestERC20 is ERC20PresetFixedSupply {
    /**
     * @notice TestERC20 constructor
     * @notice name Token name
     * @notice symbol Token symbol
     * @notice initialSupply Initial supply
     */
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20PresetFixedSupply(name, symbol, initialSupply, msg.sender) {}
}
