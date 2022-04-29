// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "contracts/interfaces/INoteAdapter.sol";

import "./LoanLibrary.sol";

/**************************************************************************/
/* ArcadeV1 Interfaces (subset) */
/**************************************************************************/

interface IPromissoryNote is IERC721 {
    function loanIdByNoteId(uint256 noteId) external view returns (uint256);
}

interface ILoanCore {
    function borrowerNote() external returns (IPromissoryNote);

    function lenderNote() external returns (IPromissoryNote);

    function collateralToken() external returns (IERC721);

    function getLoan(uint256 loanId) external view returns (LoanLibrary.LoanData calldata loanData);
}

interface IAssetWrapper {
    struct ERC20Holding {
        address tokenAddress;
        uint256 amount;
    }
    struct ERC721Holding {
        address tokenAddress;
        uint256 tokenId;
    }
    struct ERC1155Holding {
        address tokenAddress;
        uint256 tokenId;
        uint256 amount;
    }

    function bundleERC20Holdings(uint256 bundleId) external view returns (ERC20Holding[] memory);

    function bundleERC721Holdings(uint256 bundleId) external view returns (ERC721Holding[] memory);

    function bundleERC1155Holdings(uint256 bundleId) external view returns (ERC1155Holding[] memory);

    function bundleETHHoldings(uint256 bundleId) external view returns (uint256);
}

/**************************************************************************/
/* Note Adapter Implementation */
/**************************************************************************/

/**
 * @title ArcadeV1 Note Adapter
 */
contract ArcadeV1NoteAdapter is INoteAdapter {
    /**************************************************************************/
    /* Constants */
    /**************************************************************************/

    /**
     * @notice Implementation version
     */
    string public constant IMPLEMENTATION_VERSION = "1.0";

    /**************************************************************************/
    /* Properties */
    /**************************************************************************/

    ILoanCore private immutable _loanCore;
    IPromissoryNote private immutable _borrowerNote;
    IPromissoryNote private immutable _lenderNote;
    IAssetWrapper private immutable _collateralToken;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    /**
     * @notice ArcadeV1NoteAdapter constructor
     * @param loanCore Loan core contract
     */
    constructor(ILoanCore loanCore) {
        _loanCore = loanCore;
        _borrowerNote = loanCore.borrowerNote();
        _lenderNote = loanCore.lenderNote();
        _collateralToken = IAssetWrapper(address(loanCore.collateralToken()));
    }

    /**************************************************************************/
    /* Implementation */
    /**************************************************************************/

    /**
     * @inheritdoc INoteAdapter
     */
    function name() external pure returns (string memory) {
        return "Arcade v1 Note Adapter";
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function noteToken() external view returns (IERC721) {
        return IERC721(address(_lenderNote));
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function isSupported(uint256 noteTokenId, address currencyToken) external view returns (bool) {
        /* Lookup loan ID */
        uint256 loanId = _lenderNote.loanIdByNoteId(noteTokenId);

        /* Lookup loan data */
        LoanLibrary.LoanData memory loanData = _loanCore.getLoan(loanId);

        /* Vadiate loan state is active */
        if (loanData.state != LoanLibrary.LoanState.Active) return false;

        /* Validate collateral bundle is a single ERC721 (no ERC20, ERC1155, or ETH) */
        uint256 bundleId = loanData.terms.collateralTokenId;
        if (_collateralToken.bundleERC20Holdings(bundleId).length != 0) return false;
        if (_collateralToken.bundleERC1155Holdings(bundleId).length != 0) return false;
        if (_collateralToken.bundleETHHoldings(bundleId) != 0) return false;
        if (_collateralToken.bundleERC721Holdings(bundleId).length != 1) return false;

        /* Validate loan currency token matches */
        if (loanData.terms.payableCurrency != currencyToken) return false;

        return true;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function getLoanInfo(uint256 noteTokenId) external view returns (LoanInfo memory) {
        /* Lookup loan ID */
        uint256 loanId = _lenderNote.loanIdByNoteId(noteTokenId);

        /* Lookup loan data */
        LoanLibrary.LoanData memory loanData = _loanCore.getLoan(loanId);

        /* Lookup underlying collateral */
        IAssetWrapper.ERC721Holding[] memory erc721Holdings = _collateralToken.bundleERC721Holdings(
            loanData.terms.collateralTokenId
        );

        /* Arrange into LoanInfo structure */
        LoanInfo memory loanInfo = LoanInfo({
            loanId: loanId,
            borrower: _borrowerNote.ownerOf(noteTokenId),
            principal: loanData.terms.principal,
            repayment: loanData.terms.principal + loanData.terms.interest,
            maturity: uint64(loanData.dueDate),
            duration: uint64(loanData.terms.durationSecs),
            currencyToken: loanData.terms.payableCurrency,
            collateralToken: erc721Holdings[0].tokenAddress,
            collateralTokenId: erc721Holdings[0].tokenId
        });

        return loanInfo;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function getLiquidateCalldata(uint256 loanId) external view returns (address, bytes memory) {
        return (address(_loanCore), abi.encodeWithSignature("claim(uint256)", loanId));
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function getUnwrapCalldata(uint256 loanId) external view returns (address, bytes memory) {
        return (
            address(_collateralToken),
            abi.encodeWithSignature("withdraw(uint256)", _loanCore.getLoan(loanId).terms.collateralTokenId)
        );
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function isRepaid(uint256 loanId) external view returns (bool) {
        return _loanCore.getLoan(loanId).state == LoanLibrary.LoanState.Repaid;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function isLiquidated(uint256 loanId) external view returns (bool) {
        return _loanCore.getLoan(loanId).state == LoanLibrary.LoanState.Defaulted;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function isExpired(uint256 loanId) external view returns (bool) {
        /* Lookup loan data */
        LoanLibrary.LoanData memory loanData = _loanCore.getLoan(loanId);

        return loanData.state == LoanLibrary.LoanState.Active && block.timestamp > loanData.dueDate;
    }
}
