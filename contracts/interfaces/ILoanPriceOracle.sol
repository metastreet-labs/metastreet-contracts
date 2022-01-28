// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ILoanPriceOracle {
    /* Loan pricing error codes */
    error PriceError_Unsupported();
    error PriceError_InsufficientTimeRemaining();
    error PriceError_PurchasePriceOutOfBounds();

    /* Getters */
    function currencyToken() external view returns (IERC20);

    /* Primary API */
    function priceLoan(
        address collateralTokenContract,
        uint256 collateralTokenId,
        uint256 principal,
        uint256 repayment,
        uint256 duration,
        uint256 maturity
    ) external returns (uint256);

    /* Setters */
    function setTokenParameters(address tokenContract, bytes calldata packedParameters) external;

    /* Events */
    event TokenParametersUpdated(address tokenContract);
}
