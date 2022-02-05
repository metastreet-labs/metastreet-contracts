// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "./ILoanPriceOracle.sol";
import "./INoteAdapter.sol";
import "./ILoanReceiver.sol";

interface IVault is ILoanReceiver {
    /* Tranche identifier */
    enum TrancheId {
        Senior,
        Junior
    }

    /* Getters */
    function name() external view returns (string memory);

    function currencyToken() external view returns (IERC20);

    function lpToken(TrancheId trancheId) external view returns (IERC20);

    function loanPriceOracle() external view returns (ILoanPriceOracle);

    function collateralLiquidator() external view returns (address);

    function noteAdapters(address noteToken) external view returns (INoteAdapter);

    function trancheState(TrancheId trancheId)
        external
        view
        returns (
            uint256 depositValue,
            uint256 pendingRedemptions,
            uint256 redemptionQueue,
            uint256 processedRedemptionQueue
        );

    function sharePrice(TrancheId trancheId) external view returns (uint256);

    function redemptionSharePrice(TrancheId trancheId) external view returns (uint256);

    /* User API */
    function deposit(TrancheId trancheId, uint256 amount) external;

    function depositMultiple(uint256[2] calldata amounts) external;

    function sellNote(
        IERC721 noteToken,
        uint256 tokenId,
        uint256 purchasePrice
    ) external;

    function sellNoteBatch(
        IERC721[] calldata noteToken,
        uint256[] calldata tokenId,
        uint256[] calldata amounts
    ) external;

    function sellNoteAndDeposit(
        IERC721 noteToken,
        uint256 tokenId,
        uint256[2] calldata amounts
    ) external;

    function sellNoteAndDepositBatch(
        IERC721[] calldata noteToken,
        uint256[] calldata tokenId,
        uint256[2][] calldata amounts
    ) external;

    function redeem(TrancheId trancheId, uint256 shares) external;

    function redeemMultiple(uint256[2] calldata shares) external;

    function withdraw(TrancheId trancheId, uint256 amount) external;

    function withdrawMultiple(uint256[2] calldata amounts) external;

    /* Collateral Liquidator API */
    function withdrawCollateral(IERC721 noteToken, uint256 tokenId) external;

    /* Callbacks */
    function onLoanLiquidated(address noteToken, uint256 tokenId) external;

    function onCollateralLiquidated(
        address noteToken,
        uint256 tokenId,
        uint256 proceeds
    ) external;

    /* Setters */
    function setSeniorTrancheRate(uint256 interestRate) external;

    function setLoanPriceOracle(address loanPriceOracle_) external;

    function setCollateralLiquidator(address collateralLiquidator_) external;

    function setNoteAdapter(address noteToken, address noteAdapter) external;

    /* Events */
    event Deposited(address indexed account, TrancheId indexed trancheId, uint256 amount, uint256 shares);
    event NotePurchased(address indexed account, address noteToken, uint256 tokenId, uint256 purchasePrice);
    event Redeemed(address indexed account, TrancheId indexed trancheId, uint256 shares, uint256 amount);
    event Withdrawn(address indexed account, TrancheId indexed trancheId, uint256 amount);
    event CollateralWithdrawn(
        address noteToken,
        uint256 noteTokenId,
        address collateralToken,
        uint256 collateralTokenId,
        address collateralLiquidator
    );

    event SeniorTrancheRateUpdated(uint256 interestRate);
    event LoanPriceOracleUpdated(address loanPriceOracle);
    event CollateralLiquidatorUpdated(address collateralLiquidator);
    event NoteAdapterUpdated(address noteToken, address noteAdapter);
}
