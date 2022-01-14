// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "./IPriceOracle.sol";

interface IVault {
    enum Tranche { Senior, Junior }

    /* Getters */
    function name() external view returns (string memory);
    function currencyToken() external view returns (IERC20);
    function seniorLPToken() external view returns (IERC20);
    function juniorLPToken() external view returns (IERC20);
    function priceOracle() external view returns (IPriceOracle);

    /* Primary API */
    function deposit(Tranche tranche, uint256 depositAmount) external;
    function sellNote(IERC721 promissoryToken, uint256 tokenId, uint256 purchasePrice) external;
    function sellNoteAndDeposit(IERC721 promissoryToken, uint256 tokenId, uint256 purchasePrice,
                                Tranche tranche) external;
    function redeem(Tranche tranche, uint256 shares) external;
    function withdraw(Tranche tranche, uint256 amount) external;

    /* Callbacks */
    function onLoanRepayment(IERC721 promissoryToken, uint256 tokenId) external;
    function onLoanDefault(IERC721 promissoryToken, uint256 tokenId) external;
    function onLoanLiquidated(IERC721 promissoryToken, uint256 tokenId, uint256 proceeds) external;

    /* Setters */
    function setTrancheRate(Tranche tranche, uint256 interestRate) external;
    function setPriceOracle(address priceOracle_) external;

    /* Events */
    event Deposited(address indexed account, Tranche tranche, uint256 depositAmount);
    event NotePurchased(address indexed account, address promissoryToken, uint256 tokenId,
                        uint256 purchasePrice);
    event Redeemed(address indexed account, Tranche tranche, uint256 shares, uint256 amount);
    event Withdrawn(address indexed account, Tranche tranche, uint256 amount);
    event TrancheRateUpdated(Tranche tranche, uint256 interestRate);
    event PriceOracleUpdated(address priceOracle);
}
