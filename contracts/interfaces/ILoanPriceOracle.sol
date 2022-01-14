// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ILoanPriceOracle {
    /* Getters */
    function currencyToken() external view returns (IERC20);

    /* Primary API */
    function priceLoan(address tokenContract, uint256 tokenId, uint256 principal, uint256 repayment,
                       uint256 duration, uint256 maturity) external returns (uint256);

    /* Setters */
    function setTokenParameters(address tokenContract, bytes calldata packedParameters) external;

    /* Events */
    event TokenParametersUpdated(address tokenContract);
}
