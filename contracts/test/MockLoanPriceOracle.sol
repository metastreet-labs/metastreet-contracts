// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "contracts/interfaces/ILoanPriceOracle.sol";

contract MockLoanPriceOracle is ILoanPriceOracle {
    enum MockError {
        None,
        UnsupportedCollateral,
        InsufficientTimeRemaining,
        ParameterOutOfBounds
    }

    IERC20 public override currencyToken;
    MockError private _error;
    uint256 private _price;

    constructor(IERC20 currencyToken_) {
        currencyToken = currencyToken_;
    }

    function priceLoan(
        address collateralToken,
        uint256 collateralTokenId,
        uint256 principal,
        uint256 repayment,
        uint256 duration,
        uint256 maturity,
        uint256 utilization
    ) external view returns (uint256) {
        collateralToken;
        collateralTokenId;
        principal;
        repayment;
        duration;
        maturity;
        utilization;

        if (_error == MockError.UnsupportedCollateral) {
            revert UnsupportedCollateral();
        } else if (_error == MockError.InsufficientTimeRemaining) {
            revert InsufficientTimeRemaining();
        } else if (_error == MockError.ParameterOutOfBounds) {
            revert ParameterOutOfBounds(0);
        }

        return _price;
    }

    function setError(MockError error) external {
        _error = error;
    }

    function setPrice(uint256 price) external {
        _price = price;
    }
}
