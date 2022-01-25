// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "./ILoanPriceOracle.sol";
import "./INoteAdapter.sol";

interface IVault {
    /* Tranche selection enum */
    enum Tranche {
        Senior,
        Junior
    }

    /* Getters */
    function name() external view returns (string memory);
    function currencyToken() external view returns (IERC20);
    function lpToken(Tranche tranche) external view returns (IERC20);
    function loanPriceOracle() external view returns (ILoanPriceOracle);
    function noteAdapters(address noteToken) external view returns (INoteAdapter);

    function sharePrice(Tranche tranche) external view returns (uint256);

    /* Primary API */
    function deposit(Tranche tranche, uint256 amounts) external;
    function depositMultiple(uint256[2] calldata amounts) external;
    function sellNote(IERC721 noteToken, uint256 tokenId, uint256 purchasePrice) external;
    function sellNoteAndDepositMultiple(IERC721 noteToken, uint256 tokenId, uint256[2] calldata amounts) external;
    function redeem(Tranche tranche, uint256 shares) external;
    function withdraw(Tranche tranche, uint256 amount) external;

    /* Callbacks */
    function onLoanRepayment(IERC721 noteToken, uint256 tokenId) external;
    function onLoanDefault(IERC721 noteToken, uint256 tokenId) external;
    function onLoanLiquidated(IERC721 noteToken, uint256 tokenId, uint256 proceeds) external;

    /* Setters */
    function setSeniorTrancheRate(uint256 interestRate) external;
    function setLoanPriceOracle(address loanPriceOracle_) external;
    function setNoteAdapter(address noteToken, address noteAdapter) external;

    /* Events */
    event Deposited(address indexed account, Tranche indexed tranche, uint256 amount, uint256 shares);
    event NotePurchased(address indexed account, address noteToken, uint256 tokenId, uint256 purchasePrice);
    event Redeemed(address indexed account, Tranche indexed tranche, uint256 shares, uint256 amount);
    event Withdrawn(address indexed account, Tranche indexed tranche, uint256 amount);
    event SeniorTrancheRateUpdated(uint256 interestRate);
    event LoanPriceOracleUpdated(address loanPriceOracle);
    event NoteAdapterUpdated(address noteToken, address noteAdapter);
}
