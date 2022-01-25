// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract LPToken is ERC20 {
    /**************************************************************************/
    /* State */
    /**************************************************************************/

    struct Redemption {
        uint256 pending;
        uint256 withdrawn;
        uint256 redemptionCounterTarget;
    }

    address private _owner;
    mapping(address => Redemption) public redemptions;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _owner = msg.sender;
    }

    /**************************************************************************/
    /* Modifiers */
    /**************************************************************************/

    modifier onlyOwner() {
        require(_owner == msg.sender, "Caller is not the owner");
        _;
    }

    /**************************************************************************/
    /* Privileged API */
    /**************************************************************************/

    function mint(address to, uint256 amount) public virtual onlyOwner {
        _mint(to, amount);
    }

    function redeem(address account, uint256 shares, uint256 amount, uint256 redemptionCounterTarget) public onlyOwner {
        Redemption storage redemption = redemptions[account];

        require(balanceOf(account) >= shares, "Insufficent shares");
        require(redemption.pending == 0, "Redemption in progress");

        redemption.pending = amount;
        redemption.withdrawn = 0;
        redemption.redemptionCounterTarget = redemptionCounterTarget;

        _burn(account, shares);
    }

    function withdraw(address account, uint256 amount, uint256 processedRedemptionCounter) public onlyOwner {
        Redemption storage redemption = redemptions[account];

        require(redemption.pending >= amount, "Invalid amount");
        require((processedRedemptionCounter - redemption.redemptionCounterTarget - redemption.withdrawn) >= amount, "Redemption not ready");

        redemption.pending -= amount;
        redemption.withdrawn += amount;

        if (redemption.pending == 0)
            delete redemptions[account];
    }
}
