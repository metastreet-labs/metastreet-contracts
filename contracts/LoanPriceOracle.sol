// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "prb-math/contracts/PRBMathUD60x18.sol";

import "./interfaces/ILoanPriceOracle.sol";

contract LoanPriceOracle is Ownable, ILoanPriceOracle {
    /**************************************************************************/
    /* State */
    /**************************************************************************/

    struct CollateralParameters {
        /* All parameters are UD60x18 */
        uint256 minDiscountRate;
        uint256 aprSensitivity;
        uint256 minPurchasePrice;
        uint256 maxPurchasePrice;
    }

    struct TokenParameters {
        uint256 duration;
        CollateralParameters collateralParameters;
    }

    IERC20 public override currencyToken;
    mapping(address => mapping(uint256 => CollateralParameters)) public parameters;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    constructor(IERC20 currencyToken_) {
        require(IERC20Metadata(address(currencyToken_)).decimals() == 18, "Unsupported token decimals");

        currencyToken = currencyToken_;
    }

    /**************************************************************************/
    /* Internal Helper Functions */
    /**************************************************************************/

    function _mapTimeRemainingToDuration(uint256 timeRemaining) internal pure returns (uint256) {
        /* Map time remaining up to the next 30 days */
        return (30 days) * ((timeRemaining / 30 days) + 1);
    }

    /**************************************************************************/
    /* Primary API */
    /**************************************************************************/

    function priceLoan(
        address collateralTokenContract,
        uint256 collateralTokenId,
        uint256 principal,
        uint256 repayment,
        uint256 duration,
        uint256 maturity
    ) public view returns (uint256) {
        /* Unused variables */
        collateralTokenId;
        duration;

        /* Calculate time remaining of loan */
        uint256 loanTimeRemaining = maturity - block.timestamp;
        if (loanTimeRemaining < 7 days) {
            revert PriceError_InsufficientTimeRemaining();
        }

        /* Map time remaining to duration bucket for collateral parameter lookup */
        uint256 durationBucket = _mapTimeRemainingToDuration(loanTimeRemaining);

        /* Look up collateral parameters */
        CollateralParameters storage collateralParameters = parameters[collateralTokenContract][durationBucket];
        if (collateralParameters.minDiscountRate == 0) {
            revert PriceError_Unsupported();
        }

        /* Calculate discount rate */
        /* Discount Rate = APR Sensitivity * Loan Principal Amount + Min Discount Rate */
        uint256 discountRate = PRBMathUD60x18.mul(principal, collateralParameters.aprSensitivity) +
            collateralParameters.minDiscountRate;

        /* Calculate purchase price */
        /* Purchase Price = Loan Repayment Value / (1 + Discount Rate) ^ t */
        uint256 purchasePrice = PRBMathUD60x18.div(
            repayment,
            PRBMathUD60x18.powu(1e18 + discountRate, loanTimeRemaining)
        );

        /* Validate purchase price is in bounds */
        if (
            purchasePrice < collateralParameters.minPurchasePrice ||
            purchasePrice > collateralParameters.maxPurchasePrice
        ) {
            revert PriceError_PurchasePriceOutOfBounds();
        }

        return purchasePrice;
    }

    /**************************************************************************/
    /* Setters */
    /**************************************************************************/

    function setTokenParameters(address tokenContract, bytes calldata packedTokenParameters) public onlyOwner {
        TokenParameters[] memory tokenParameters = abi.decode(packedTokenParameters, (TokenParameters[]));

        for (uint256 i = 0; i < tokenParameters.length; i++) {
            parameters[tokenContract][tokenParameters[i].duration] = tokenParameters[i].collateralParameters;
        }

        emit TokenParametersUpdated(tokenContract);
    }
}
