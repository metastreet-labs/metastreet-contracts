// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "contracts/Vault.sol";

/**
 * @title Test contract for Vault upgrades
 */
contract TestVaultUpgrade is Vault {
    /* New dummy method */
    function totalRealizedValue() external view returns (uint256) {
        return _seniorTranche.realizedValue + _juniorTranche.realizedValue;
    }
}
