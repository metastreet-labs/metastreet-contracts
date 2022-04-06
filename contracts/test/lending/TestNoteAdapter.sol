// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "contracts/interfaces/INoteAdapter.sol";

import "./TestLendingPlatform.sol";

contract TestNoteAdapter is INoteAdapter {
    TestLendingPlatform private immutable _lendingPlatform;

    constructor(TestLendingPlatform testLendingPlatform) {
        _lendingPlatform = testLendingPlatform;
    }

    function noteToken() public view returns (IERC721) {
        return IERC721(_lendingPlatform.noteToken());
    }

    function getLoanInfo(uint256 noteTokenId) public view returns (LoanInfo memory) {
        /* Get loan from lending platform */
        (
            TestLendingPlatform.LoanStatus status,
            address borrower,
            uint256 principal,
            uint256 repayment,
            uint64 startTime,
            uint32 duration,
            address collateralToken,
            uint256 collateralTokenId
        ) = _lendingPlatform.loans(noteTokenId);

        /* Check loan exists */
        require(status != TestLendingPlatform.LoanStatus.Unknown, "Unknown loan");

        /* Arrange into LoanInfo structure */
        LoanInfo memory loanInfo;
        loanInfo.borrower = borrower;
        loanInfo.principal = principal;
        loanInfo.repayment = repayment;
        loanInfo.maturity = startTime + duration;
        loanInfo.duration = duration;
        loanInfo.currencyToken = address(_lendingPlatform.currencyToken());
        loanInfo.collateralToken = collateralToken;
        loanInfo.collateralTokenId = collateralTokenId;

        return loanInfo;
    }

    function getLiquidateCalldata(uint256 noteTokenId) public view returns (address, bytes memory) {
        return (address(_lendingPlatform), abi.encodeWithSignature("liquidate(uint256)", noteTokenId));
    }

    function isSupported(uint256 noteTokenId, address currencyToken) public view returns (bool) {
        /* All collateral tokens supported, so just check the note exists and
         * the currency token matches */
        return
            _lendingPlatform.noteToken().exists(noteTokenId) &&
            address(_lendingPlatform.currencyToken()) == currencyToken;
    }

    function isRepaid(uint256 noteTokenId) public view returns (bool) {
        /* Get loan status from lending platform */
        (TestLendingPlatform.LoanStatus status, , , , , , , ) = _lendingPlatform.loans(noteTokenId);
        return status == TestLendingPlatform.LoanStatus.Repaid;
    }

    function isLiquidated(uint256 noteTokenId) public view returns (bool) {
        /* Get loan status from lending platform */
        (TestLendingPlatform.LoanStatus status, , , , , , , ) = _lendingPlatform.loans(noteTokenId);
        return status == TestLendingPlatform.LoanStatus.Liquidated;
    }

    function isExpired(uint256 noteTokenId) public view returns (bool) {
        /* Get loan maturity from lending platform */
        (, , , , uint64 startTime, uint32 duration, , ) = _lendingPlatform.loans(noteTokenId);
        return block.timestamp > startTime + duration;
    }
}
