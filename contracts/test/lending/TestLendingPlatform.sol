// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "contracts/interfaces/ILoanReceiver.sol";

import "./TestNoteToken.sol";

/**
 * @title Test Lending Platform
 */
contract TestLendingPlatform is Ownable, ERC721Holder, ERC165 {
    using SafeERC20 for IERC20;

    /**************************************************************************/
    /* Events */
    /**************************************************************************/

    /**
     * @notice Emitted when a loan is created
     * @param loanId Loan ID
     * @param borrower Borrower
     * @param lender Lender
     */
    event LoanCreated(uint256 loanId, address borrower, address lender);

    /**
     * @notice Emitted when a loan is repaid
     * @param loanId Loan ID
     */
    event LoanRepaid(uint256 loanId);

    /**
     * @notice Emitted when a loan is liquidated
     * @param loanId Loan ID
     */
    event LoanLiquidated(uint256 loanId);

    /**************************************************************************/
    /* Structures */
    /**************************************************************************/

    /**
     * @notice Loan status
     */
    enum LoanStatus {
        Unknown,
        Active,
        Repaid,
        Liquidated
    }

    /**
     * @notice Collateral asset
     * @param token Token contract
     * @param tokenId Token ID
     */
    struct CollateralAsset {
        address token;
        uint256 tokenId;
    }

    /**
     * @notice Loan terms
     * @param status Loan status
     * @param borrower Borrower
     * @param principal Principal amount
     * @param repayment Repayment amount
     * @param startTime Start timestamp
     * @param duration Duration in seconds
     * @param collateralAssets Collateral assets
     */
    struct LoanTerms {
        LoanStatus status;
        address borrower;
        uint256 principal;
        uint256 repayment;
        uint64 startTime;
        uint32 duration;
        CollateralAsset[] collateralAssets;
    }

    /**************************************************************************/
    /* Properties and State */
    /**************************************************************************/

    /**
     * @dev Currency token
     */
    IERC20 public immutable currencyToken;

    /**
     * @dev Promissory note token
     */
    TestNoteToken public immutable noteToken;

    /**
     * @dev Mapping of loan ID to loan terms
     */
    mapping(uint256 => LoanTerms) private _loans;

    /**
     * @dev Loan ID counter
     */
    uint256 private _loanId;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    /**
     * @notice TestLendingPlatform constructor
     * @param currencyToken_ Currency token
     */
    constructor(IERC20 currencyToken_) {
        currencyToken = currencyToken_;
        noteToken = new TestNoteToken();
    }

    /**************************************************************************/
    /* Getter */
    /**************************************************************************/

    function loans(uint256 loanId) external view returns (LoanTerms memory) {
        return _loans[loanId];
    }

    /**************************************************************************/
    /* Primary API */
    /**************************************************************************/

    /**
     * @notice Create a new loan
     *
     * Emits a {LoanCreated} event.
     *
     * @param borrower Borrower
     * @param lender Lender
     * @param collateralToken Collateral token contract
     * @param collateralTokenId Collateral token ID
     * @param principal Principal amount
     * @param repayment Repayment amount
     * @param duration Duration in seconds
     */
    function lend(
        address borrower,
        address lender,
        IERC721 collateralToken,
        uint256 collateralTokenId,
        uint256 principal,
        uint256 repayment,
        uint32 duration
    ) external {
        CollateralAsset[] memory collateralAssets = new CollateralAsset[](1);
        collateralAssets[0] = CollateralAsset({token: address(collateralToken), tokenId: collateralTokenId});
        lendAgainstMultiple(borrower, lender, collateralAssets, principal, repayment, duration);
    }

    /**
     * @notice Create a new loan against multiple collateral assets
     *
     * Emits a {LoanCreated} event.
     *
     * @param borrower Borrower
     * @param lender Lender
     * @param collateralAssets Collateral assets
     * @param principal Principal amount
     * @param repayment Repayment amount
     * @param duration Duration in seconds
     */
    function lendAgainstMultiple(
        address borrower,
        address lender,
        CollateralAsset[] memory collateralAssets,
        uint256 principal,
        uint256 repayment,
        uint32 duration
    ) public {
        require(repayment >= principal, "Repayment less than principal");

        uint256 loanId = _loanId++;

        LoanTerms storage loan = _loans[loanId];
        loan.status = LoanStatus.Active;
        loan.borrower = borrower;
        loan.principal = principal;
        loan.repayment = repayment;
        loan.startTime = uint64(block.timestamp);
        loan.duration = duration;

        for (uint256 i; i < collateralAssets.length; i++) {
            loan.collateralAssets.push(collateralAssets[i]);
            IERC721(collateralAssets[i].token).safeTransferFrom(borrower, address(this), collateralAssets[i].tokenId);
        }
        currencyToken.safeTransferFrom(lender, borrower, principal);
        noteToken.mint(lender, loanId);

        emit LoanCreated(loanId, borrower, lender);
    }

    /**
     * @notice Repay a loan
     *
     * Emits a {LoanRepaid} event.
     *
     * @param loanId Loan ID
     * @param callback Callback to loan holder
     */
    function repay(uint256 loanId, bool callback) external {
        LoanTerms storage loan = _loans[loanId];

        require(loan.status != LoanStatus.Unknown, "Unknown loan");
        require(loan.status == LoanStatus.Active, "Loan already complete");
        require(loan.borrower == msg.sender, "Invalid caller");

        loan.status = LoanStatus.Repaid;

        address noteOwner = noteToken.ownerOf(loanId);

        currencyToken.safeTransferFrom(loan.borrower, noteOwner, loan.repayment);
        for (uint256 i; i < loan.collateralAssets.length; i++)
            IERC721(loan.collateralAssets[i].token).safeTransferFrom(
                address(this),
                loan.borrower,
                loan.collateralAssets[i].tokenId
            );
        noteToken.burn(loanId);

        if (callback && ERC165Checker.supportsInterface(noteOwner, type(ILoanReceiver).interfaceId))
            ILoanReceiver(noteOwner).onLoanRepaid(address(noteToken), loanId);

        emit LoanRepaid(loanId);
    }

    /**
     * @notice Liquidate a loan
     *
     * Emits a {LoanLiquidated} event.
     *
     * @param loanId Loan ID
     */
    function liquidate(uint256 loanId) external {
        LoanTerms storage loan = _loans[loanId];

        require(loan.status != LoanStatus.Unknown, "Unknown loan");
        require(loan.status == LoanStatus.Active, "Loan already complete");
        require(block.timestamp > loan.startTime + loan.duration, "Loan not expired");
        require(noteToken.ownerOf(loanId) == msg.sender, "Invalid caller");

        loan.status = LoanStatus.Liquidated;

        for (uint256 i; i < loan.collateralAssets.length; i++)
            IERC721(loan.collateralAssets[i].token).safeTransferFrom(
                address(this),
                noteToken.ownerOf(loanId),
                loan.collateralAssets[i].tokenId
            );
        noteToken.burn(loanId);

        emit LoanLiquidated(loanId);
    }

    /******************************************************/
    /* ERC165 interface */
    /******************************************************/

    /**
     * @inheritdoc IERC165
     */
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC721Receiver).interfaceId || super.supportsInterface(interfaceId);
    }
}
