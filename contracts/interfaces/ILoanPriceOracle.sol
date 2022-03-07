// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ILoanPriceOracle {
    /* Loan pricing error codes */
    error PriceError_UnsupportedCollateral();
    error PriceError_InsufficientTimeRemaining();
    error PriceError_ParameterOutOfBounds(uint256 index);

    /* Getters */
    function currencyToken() external view returns (IERC20);

    /* Primary API */
    function priceLoan(
        address collateralToken,
        uint256 collateralTokenId,
        uint256 principal,
        uint256 repayment,
        uint256 duration,
        uint256 maturity,
        uint256 utilization
    ) external returns (uint256);
}
