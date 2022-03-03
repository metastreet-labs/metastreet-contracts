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

    struct PiecewiseLinearModel {
        /* All parameters are UD60x18 */
        uint256 slope1;
        uint256 slope2;
        uint256 target;
        uint256 max;
    }

    struct CollateralParameters {
        uint256 collateralValue; /* UD60x18 */
        PiecewiseLinearModel aprUtilizationSensitivity;
        PiecewiseLinearModel aprLoanToValueSensitivity;
        PiecewiseLinearModel aprDurationSensitivity;
        uint8[3] sensitivityWeights; /* 0-100 */
    }

    IERC20 public override currencyToken;
    mapping(address => CollateralParameters) public parameters;
    uint256 public minimumDiscountRate; /* UD60x18, in amount per seconds */

    /**************************************************************************/
    /* Events */
    /**************************************************************************/

    event MinimumDiscountRateUpdated(uint256 rate);
    event CollateralParametersUpdated(address tokenContract);

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

    function _computeRateComponent(PiecewiseLinearModel storage model, uint256 x) internal view returns (uint256) {
        uint256 y = (x <= model.target)
            ? minimumDiscountRate + PRBMathUD60x18.mul(x, model.slope1)
            : minimumDiscountRate +
                PRBMathUD60x18.mul(model.target, model.slope1) +
                PRBMathUD60x18.mul(x - model.target, model.slope2);
        return (x < model.max) ? y : type(uint256).max;
    }

    function _computeWeightedRate(uint8[3] storage weights, uint256[3] memory components)
        internal
        view
        returns (uint256)
    {
        return
            PRBMathUD60x18.div(
                PRBMathUD60x18.mul(components[0], PRBMathUD60x18.fromUint(weights[0])) +
                    PRBMathUD60x18.mul(components[1], PRBMathUD60x18.fromUint(weights[1])) +
                    PRBMathUD60x18.mul(components[2], PRBMathUD60x18.fromUint(weights[2])),
                PRBMathUD60x18.fromUint(100)
            );
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
        uint256 maturity,
        uint256 utilization
    ) public view returns (uint256) {
        /* Unused variables */
        collateralTokenId;
        duration;

        /* Calculate loan time remaining */
        uint256 loanTimeRemaining = maturity - block.timestamp;
        if (loanTimeRemaining < 7 days) {
            revert PriceError_InsufficientTimeRemaining();
        }

        /* Look up collateral parameters */
        CollateralParameters storage collateralParameters = parameters[collateralTokenContract];
        if (collateralParameters.collateralValue == 0) {
            revert PriceError_Unsupported();
        }

        /* Convert loan time remaining */
        loanTimeRemaining = PRBMathUD60x18.fromUint(loanTimeRemaining);

        /* Calculate loan to value */
        uint256 loanToValue = PRBMathUD60x18.div(principal, collateralParameters.collateralValue);

        /* Compute discount rate components for utilization, loan-to-value, and duration */
        uint256[3] memory rateComponents = [
            _computeRateComponent(collateralParameters.aprUtilizationSensitivity, utilization),
            _computeRateComponent(collateralParameters.aprLoanToValueSensitivity, loanToValue),
            _computeRateComponent(collateralParameters.aprDurationSensitivity, loanTimeRemaining)
        ];

        /* Check component validities */
        if (rateComponents[0] == type(uint256).max) {
            revert PriceError_ParameterOutOfBounds(0);
        }
        if (rateComponents[1] == type(uint256).max) {
            revert PriceError_ParameterOutOfBounds(1);
        }
        if (rateComponents[2] == type(uint256).max) {
            revert PriceError_ParameterOutOfBounds(2);
        }

        /* Calculate discount rate from components */
        uint256 discountRate = _computeWeightedRate(collateralParameters.sensitivityWeights, rateComponents);

        /* Calculate purchase price */
        /* Purchase Price = Loan Repayment Value / (1 + Discount Rate * t) */
        uint256 purchasePrice = PRBMathUD60x18.div(
            repayment,
            1e18 + PRBMathUD60x18.mul(discountRate, loanTimeRemaining)
        );

        return purchasePrice;
    }

    /**************************************************************************/
    /* Setters */
    /**************************************************************************/

    function setMinimumDiscountRate(uint256 rate) public onlyOwner {
        minimumDiscountRate = rate;

        emit MinimumDiscountRateUpdated(rate);
    }

    function setCollateralParameters(address tokenContract, bytes calldata packedTokenParameters) public onlyOwner {
        parameters[tokenContract] = abi.decode(packedTokenParameters, (CollateralParameters));

        emit CollateralParametersUpdated(tokenContract);
    }
}
