// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetFixedSupply.sol";

contract TestERC20 is ERC20PresetFixedSupply {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20PresetFixedSupply(name, symbol, initialSupply, msg.sender) {
    }
}
