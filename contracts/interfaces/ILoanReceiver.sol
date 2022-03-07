// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

/**
 * @title Interface containing callbacks for smart contract loan holders
 * @notice Lending platforms should detect if a lender implements this
 * interface and call it on loan operations (e.g. repayment, liquidation, etc.)
 */
interface ILoanReceiver {
    /**
     * @notice Callback on loan repaid
     * @param noteToken Note token contract
     * @param noteTokenId Note token ID
     */
    function onLoanRepaid(address noteToken, uint256 noteTokenId) external;

    /**
     * @notice Callback on loan liquidated
     * @param noteToken Note token contract
     * @param noteTokenId Note token ID
     */
    function onLoanLiquidated(address noteToken, uint256 noteTokenId) external;
}
