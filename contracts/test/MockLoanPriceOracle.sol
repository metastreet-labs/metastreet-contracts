// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "contracts/interfaces/ILoanPriceOracle.sol";

contract MockLoanPriceOracle is ILoanPriceOracle {
    enum MockError {
        None,
        Unsupported,
        InsufficientTimeRemaining,
        PurchasePriceOutOfBounds
    }

    IERC20 public override currencyToken;
    MockError private _error;
    uint256 private _price;

    constructor(IERC20 currencyToken_) {
        currencyToken = currencyToken_;
    }

    function priceLoan(
        address collateralTokenContract,
        uint256 collateralTokenId,
        uint256 principal,
        uint256 repayment,
        uint256 duration,
        uint256 maturity
    ) public view returns (uint256) {
        collateralTokenContract;
        collateralTokenId;
        principal;
        repayment;
        duration;
        maturity;

        if (_error == MockError.Unsupported) {
            revert PriceError_Unsupported();
        } else if (_error == MockError.InsufficientTimeRemaining) {
            revert PriceError_InsufficientTimeRemaining();
        } else if (_error == MockError.PurchasePriceOutOfBounds) {
            revert PriceError_PurchasePriceOutOfBounds();
        }

        return _price;
    }

    function setTokenParameters(address tokenContract, bytes calldata packedParameters) public {}

    function setState(MockError error, uint256 price) public {
        _error = error;
        _price = price;
    }
}
