// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

abstract contract LPTokenStorageV1 {
    struct Redemption {
        uint256 pending;
        uint256 withdrawn;
        uint256 redemptionQueueTarget;
    }

    mapping(address => Redemption) public redemptions;
}

abstract contract LPTokenStorage is LPTokenStorageV1 {}

contract LPToken is Ownable, ERC20, LPTokenStorage {
    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    /**************************************************************************/
    /* Privileged API */
    /**************************************************************************/

    function mint(address to, uint256 amount) public virtual onlyOwner {
        _mint(to, amount);
    }

    function redeem(
        address account,
        uint256 shares,
        uint256 amount,
        uint256 redemptionQueueTarget
    ) public onlyOwner {
        Redemption storage redemption = redemptions[account];

        require(balanceOf(account) >= shares, "Insufficient shares");
        require(redemption.pending == 0, "Redemption in progress");

        redemption.pending = amount;
        redemption.withdrawn = 0;
        redemption.redemptionQueueTarget = redemptionQueueTarget;

        _burn(account, shares);
    }

    function withdraw(
        address account,
        uint256 amount,
        uint256 processedRedemptionQueue
    ) public onlyOwner {
        Redemption storage redemption = redemptions[account];

        require(redemption.pending >= amount, "Invalid amount");
        require(
            (processedRedemptionQueue -
                (redemption.redemptionQueueTarget - redemption.pending + redemption.withdrawn)) >= amount,
            "Redemption not ready"
        );

        redemption.withdrawn += amount;

        if (redemption.withdrawn == redemption.pending) delete redemptions[account];
    }
}
