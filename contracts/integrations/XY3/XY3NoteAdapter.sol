// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "contracts/interfaces/INoteAdapter.sol";

/**************************************************************************/
/* XY3 Interfaces (subset) */
/**************************************************************************/

/* IXY3 and ILoanStatus */
interface IXY3 {
    enum StatusType {
        NOT_EXISTS,
        NEW,
        RESOLVED
    }

    struct LoanState {
        uint64 xy3NftId;
        StatusType status;
    }

    function loanDetails(uint32)
        external
        view
        returns (
            uint256, /* borrowAmount */
            uint256, /* repayAmount */
            uint256, /* nftTokenId */
            address, /* borrowAsset */
            uint32, /* loanDuration */
            uint16, /* adminShare */
            uint64, /* loanStart */
            address, /* nftAsset */
            address, /* borrower */
            bool /* isCollection */
        );

    function getLoanState(uint32 _loanId) external view returns (LoanState memory);
}

interface IXY3Nft {
    struct Ticket {
        uint256 loanId;
        address minter; /* xy3 address */
    }

    function tickets(uint256 _tokenId) external view returns (Ticket memory);

    function exists(uint256 _tokenId) external view returns (bool);
}

/**************************************************************************/
/* Note Adapter Implementation */
/**************************************************************************/

/**
 * @title X2Y2 Note Adapter
 */
contract XY3NoteAdapter is INoteAdapter {
    /**************************************************************************/
    /* Constants */
    /**************************************************************************/

    /**
     * @notice Implementation version
     */
    string public constant IMPLEMENTATION_VERSION = "1.0";

    /**
     * @notice Basis points denominator used for calculating repayment
     */
    uint256 public constant BASIS_POINTS_DENOMINATOR = 10_000;

    /**************************************************************************/
    /* Properties */
    /**************************************************************************/

    IXY3 private immutable _xy3;
    IXY3Nft private immutable _ticketToken;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    constructor(IXY3 xY3, IXY3Nft ticketToken) {
        _xy3 = xY3;
        _ticketToken = ticketToken;
    }

    /**************************************************************************/
    /* Implementation */
    /**************************************************************************/

    /**
     * @inheritdoc INoteAdapter
     */
    function name() external pure returns (string memory) {
        return "XY3 Note Adapter";
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function noteToken() external view returns (IERC721) {
        return IERC721(address(_ticketToken));
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function isSupported(uint256 noteTokenId, address currencyToken) external view returns (bool) {
        /* Validate note token exists */
        if (!_ticketToken.exists(noteTokenId)) return false;

        /* Lookup minter and loan id */
        IXY3Nft.Ticket memory ticket = _ticketToken.tickets(noteTokenId);

        /* Validate XY3 minter matches */
        if (ticket.minter != address(_xy3)) return false;

        /* Validate loan is active */
        if (_xy3.getLoanState(uint32(ticket.loanId)).status != IXY3.StatusType.NEW) return false;

        /* Lookup loan current token */
        (, , , address borrowAsset, , , , , , ) = _xy3.loanDetails(uint32(ticket.loanId));

        /* Validate loan currency token matches */
        if (borrowAsset != currencyToken) return false;

        return true;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function getLoanInfo(uint256 noteTokenId) external view returns (LoanInfo memory) {
        /* Lookup minter and loan id */
        IXY3Nft.Ticket memory ticket = _ticketToken.tickets(noteTokenId);

        /* Lookup loan data */
        (
            uint256 borrowAmount,
            uint256 repayAmount,
            uint256 nftTokenId,
            address borrowAsset,
            uint32 loanDuration,
            uint16 adminShare,
            uint64 loanStart,
            address nftAsset,
            address borrower,

        ) = _xy3.loanDetails(uint32(ticket.loanId));

        /* Calculate admin fee */
        uint256 adminFee = ((repayAmount - borrowAmount) * uint256(adminShare)) / BASIS_POINTS_DENOMINATOR;

        /* Arrange into LoanInfo structure */
        LoanInfo memory loanInfo = LoanInfo({
            loanId: ticket.loanId,
            borrower: borrower,
            principal: borrowAmount,
            repayment: repayAmount - adminFee,
            maturity: loanStart + loanDuration,
            duration: loanDuration,
            currencyToken: borrowAsset,
            collateralToken: nftAsset,
            collateralTokenId: nftTokenId
        });

        return loanInfo;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function getLoanAssets(uint256 noteTokenId) external view returns (AssetInfo[] memory) {
        /* Lookup minter and loan id */
        IXY3Nft.Ticket memory ticket = _ticketToken.tickets(noteTokenId);

        /* Lookup loan data */
        (, , uint256 nftTokenId, , , , , address nftAsset, , ) = _xy3.loanDetails(uint32(ticket.loanId));

        /* Collect collateral assets */
        AssetInfo[] memory collateralAssets = new AssetInfo[](1);
        collateralAssets[0].token = nftAsset;
        collateralAssets[0].tokenId = nftTokenId;

        return collateralAssets;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function getLiquidateCalldata(uint256 loanId) external view returns (address, bytes memory) {
        return (address(_xy3), abi.encodeWithSignature("liquidate(uint32)", uint32(loanId)));
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function getUnwrapCalldata(uint256) external pure returns (address, bytes memory) {
        return (address(0), "");
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function isRepaid(uint256 loanId) external view returns (bool) {
        /* No way to differentiate a repaid loan from a liquidated loan from just loanId */
        return _xy3.getLoanState(uint32(loanId)).status == IXY3.StatusType.RESOLVED;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function isLiquidated(uint256 loanId) external view returns (bool) {
        /* No way to differentiate a repaid loan from a liquidated loan from just loanId */
        return _xy3.getLoanState(uint32(loanId)).status == IXY3.StatusType.RESOLVED;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function isExpired(uint256 loanId) external view returns (bool) {
        /* Lookup loan data */
        (, , , , uint32 loanDuration, , uint64 loanStart, , , ) = _xy3.loanDetails(uint32(loanId));

        return
            _xy3.getLoanState(uint32(loanId)).status == IXY3.StatusType.NEW &&
            block.timestamp > loanStart + loanDuration;
    }
}
