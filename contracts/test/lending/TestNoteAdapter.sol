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
            address borrower,
            uint256 principal,
            uint256 repayment,
            uint64 startTime,
            uint32 duration,
            address collateralToken,
            uint256 collateralTokenId
        ) = _lendingPlatform.loans(noteTokenId);

        /* Check loan exists */
        require(borrower != address(0x0), "Unknown loan");

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

    function isComplete(uint256 noteTokenId) public view returns (bool) {
        return _lendingPlatform.loansComplete(noteTokenId);
    }
}
