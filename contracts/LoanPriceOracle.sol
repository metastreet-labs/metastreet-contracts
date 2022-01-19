// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/ILoanPriceOracle.sol";

import "hardhat/console.sol";

contract LoanPriceOracle is ILoanPriceOracle, Ownable {
    /**************************************************************************/
    /* State */
    /**************************************************************************/

    IERC20 public override currencyToken;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    constructor(IERC20 currencyToken_) {
        currencyToken = currencyToken_;
    }

    /**************************************************************************/
    /* Primary API */
    /**************************************************************************/

    function priceLoan(address tokenContract, uint256 tokenId, uint256 principal, uint256 repayment, uint256 duration, uint256 maturity) public view returns (uint256) {
        console.log("priceLoan(tokenContract %s, tokenId %s, principal %s, ...)", tokenContract, tokenId, principal);
        repayment; duration; maturity;

        /* FIXME */

        return 123;
    }

    /**************************************************************************/
    /* Setters */
    /**************************************************************************/

    function setTokenParameters(address tokenContract, bytes calldata packedParameters) public onlyOwner {
        console.log("SetTokenParameters(tokenContract %s, ...)", tokenContract);
        packedParameters;

        /* FIXME */

        emit TokenParametersUpdated(tokenContract);
    }
}