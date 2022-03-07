// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

abstract contract LPTokenStorageV1 {
    struct Redemption {
        uint256 pending;
        uint256 withdrawn;
        uint256 redemptionQueueTarget;
    }

    mapping(address => Redemption) internal _redemptions;
}

abstract contract LPTokenStorage is LPTokenStorageV1 {}

contract LPToken is Initializable, OwnableUpgradeable, ERC20Upgradeable, LPTokenStorage {
    /**************************************************************************/
    /* Constants */
    /**************************************************************************/

    string public constant IMPLEMENTATION_VERSION = "1.0";

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    function initialize(string memory name, string memory symbol) external initializer {
        __Ownable_init();
        __ERC20_init(name, symbol);
    }

    /**************************************************************************/
    /* Getters */
    /**************************************************************************/

    function redemptions(address account) external view returns (Redemption memory) {
        return _redemptions[account];
    }

    function redemptionAvailable(address account, uint256 processedRedemptionQueue) external view returns (uint256) {
        Redemption storage redemption = _redemptions[account];

        if (redemption.pending == 0) {
            /* No redemption pending */
            return 0;
        } else if (processedRedemptionQueue >= redemption.redemptionQueueTarget) {
            /* Full redemption available for withdraw */
            return redemption.pending - redemption.withdrawn;
        } else {
            /* Partial redemption available for withdraw */
            return
                processedRedemptionQueue -
                (redemption.redemptionQueueTarget - redemption.pending + redemption.withdrawn);
        }
    }

    /**************************************************************************/
    /* Privileged API */
    /**************************************************************************/

    function mint(address to, uint256 amount) external virtual onlyOwner {
        _mint(to, amount);
    }

    function redeem(
        address account,
        uint256 shares,
        uint256 amount,
        uint256 redemptionQueueTarget
    ) external onlyOwner {
        Redemption storage redemption = _redemptions[account];

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
    ) external onlyOwner {
        Redemption storage redemption = _redemptions[account];

        require(redemption.pending >= amount, "Invalid amount");
        require(
            (processedRedemptionQueue -
                (redemption.redemptionQueueTarget - redemption.pending + redemption.withdrawn)) >= amount,
            "Redemption not ready"
        );

        redemption.withdrawn += amount;

        if (redemption.withdrawn == redemption.pending) {
            delete _redemptions[account];
        }
    }
}
