// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/**
 * @title Storage for LPToken, V1
 */
abstract contract LPTokenStorageV1 {
    /**
     * @notice Redemption state for account
     * @param pending Pending redemption amount
     * @param withdrawn Withdrawn redemption amount
     * @param redemptionQueueTarget Target in vault's redemption queue
     */
    struct Redemption {
        uint256 pending;
        uint256 withdrawn;
        uint256 redemptionQueueTarget;
    }

    /**
     * @dev Mapping of account to redemption state
     */
    mapping(address => Redemption) internal _redemptions;
}

/**
 * @title Storage for LPToken, aggregated
 */
abstract contract LPTokenStorage is LPTokenStorageV1 {

}

/**
 * @title Liquidity Provider (LP) Token for Vault Tranches
 */
contract LPToken is Initializable, OwnableUpgradeable, ERC20Upgradeable, LPTokenStorage {
    /**************************************************************************/
    /* Constants */
    /**************************************************************************/

    /**
     * @notice Implementation version
     */
    string public constant IMPLEMENTATION_VERSION = "1.0";

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    /**
     * @notice LPToken constructor (for proxy)
     * @param name Token name
     * @param symbol Token symbol
     */
    function initialize(string memory name, string memory symbol) external initializer {
        __Ownable_init();
        __ERC20_init(name, symbol);
    }

    /**************************************************************************/
    /* Getters */
    /**************************************************************************/

    /**
     * @notice Get redemption state for account
     * @param account Account
     * @return Redemption state
     */
    function redemptions(address account) external view returns (Redemption memory) {
        return _redemptions[account];
    }

    /**
     * @notice Get amount of redemption available for withdraw for account
     * @param account Account
     * @param processedRedemptionQueue Current value of vault's processed
     * redemption queue
     * @return Amount available for withdraw
     */
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

    /**
     * @notice Mint tokens to account
     * @param to Recipient account
     * @param amount Amount of tokens
     */
    function mint(address to, uint256 amount) external virtual onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from account for redemption
     * @param account Redeeming account
     * @param shares Amount of LP tokens
     * @param amount Amount of currency tokens
     * @param redemptionQueueTarget Target in vault's redemption queue
     */
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

    /**
     * @notice Update account's redemption state for withdraw
     * @param account Redeeming account
     * @param amount Amount of currency tokens
     * @param processedRedemptionQueue Current value of vault's processed
     * redemption queue
     */
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
