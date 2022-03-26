// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "contracts/LPToken.sol";

/**
 * @title Test contract for LPToken upgrades:
 */
contract TestLPTokenUpgrade is LPToken {
    /* New dummy method */
    function redemptionPending(address account) external view returns (uint256) {
        return _redemptions[account].pending;
    }
}
