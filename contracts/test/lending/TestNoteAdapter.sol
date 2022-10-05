// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.9;

import "contracts/interfaces/INoteAdapter.sol";

import "./TestLendingPlatform.sol";

/**
 * @title Test Note Adapter
 */
contract TestNoteAdapter is INoteAdapter {
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

    TestLendingPlatform private immutable _lendingPlatform;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    /**
     * @notice TestNoteAdapter constructor
     * @param testLendingPlatform Test lending platform contract
     */
    constructor(TestLendingPlatform testLendingPlatform) {
        _lendingPlatform = testLendingPlatform;
    }

    /**************************************************************************/
    /* Implementation */
    /**************************************************************************/

    /**
     * @inheritdoc INoteAdapter
     */
    function name() external pure returns (string memory) {
        return "Test Note Adapter";
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function noteToken() external view returns (IERC721) {
        return IERC721(_lendingPlatform.noteToken());
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function isSupported(uint256 noteTokenId, address currencyToken) external view returns (bool) {
        /* Validate note exists */
        if (!_lendingPlatform.noteToken().exists(noteTokenId)) return false;

        /* Look up loan terms */
        TestLendingPlatform.LoanTerms memory loanTerms = _lendingPlatform.loans(noteTokenId);

        /* Validate loan is active */
        if (loanTerms.status != TestLendingPlatform.LoanStatus.Active) return false;

        /* Validate loan currency token matches */
        if (address(_lendingPlatform.currencyToken()) != currencyToken) return false;

        return true;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function getLoanInfo(uint256 noteTokenId) external view returns (LoanInfo memory) {
        /* Get loan terms from lending platform */
        TestLendingPlatform.LoanTerms memory loanTerms = _lendingPlatform.loans(noteTokenId);

        /* Arrange into LoanInfo structure */
        LoanInfo memory loanInfo = LoanInfo({
            loanId: noteTokenId,
            borrower: loanTerms.borrower,
            principal: loanTerms.principal,
            repayment: loanTerms.repayment,
            maturity: loanTerms.startTime + loanTerms.duration,
            duration: loanTerms.duration,
            currencyToken: address(_lendingPlatform.currencyToken()),
            collateralToken: loanTerms.collateralToken,
            collateralTokenId: loanTerms.collateralTokenId
        });

        return loanInfo;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function getLiquidateCalldata(uint256 loanId) external view returns (address, bytes memory) {
        return (address(_lendingPlatform), abi.encodeWithSignature("liquidate(uint256)", loanId));
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function getUnwrapCalldata(uint256 loanId) external view returns (address, bytes memory) {
        /* Get collateral token info from lending platform */
        TestLendingPlatform.LoanTerms memory loanTerms = _lendingPlatform.loans(loanId);

        /* Dummy operation to test unwrap call in Vault withdrawCollateral() */
        if (IERC721(loanTerms.collateralToken).ownerOf(loanTerms.collateralTokenId) == msg.sender) {
            return (
                loanTerms.collateralToken,
                abi.encodeWithSignature(
                    "transferFrom(address,address,uint256)",
                    msg.sender,
                    msg.sender,
                    loanTerms.collateralTokenId
                )
            );
        } else {
            return (address(0), "");
        }
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function isRepaid(uint256 loanId) external view returns (bool) {
        return _lendingPlatform.loans(loanId).status == TestLendingPlatform.LoanStatus.Repaid;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function isLiquidated(uint256 loanId) external view returns (bool) {
        return _lendingPlatform.loans(loanId).status == TestLendingPlatform.LoanStatus.Liquidated;
    }

    /**
     * @inheritdoc INoteAdapter
     */
    function isExpired(uint256 loanId) external view returns (bool) {
        /* Get loan terms */
        TestLendingPlatform.LoanTerms memory loanTerms = _lendingPlatform.loans(loanId);
        return
            loanTerms.status == TestLendingPlatform.LoanStatus.Active &&
            block.timestamp > loanTerms.startTime + loanTerms.duration;
    }
}
