// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title Interface to a note adapter, a generic interface to a lending
 * platform.
 */
interface INoteAdapter {
    /**************************************************************************/
    /* Structures */
    /**************************************************************************/

    /**
     * @notice Loan information
     * @param borrower Borrower
     * @param principal Principal value
     * @param repayment Repayment value
     * @param maturity Maturity in seconds since Unix epoch
     * @param duration Duration in seconds
     * @param currencyToken Currency token used by loan
     * @param collateralToken Collateral token contract
     * @param collateralTokenId Collateral token ID
     */
    struct LoanInfo {
        address borrower;
        uint256 principal;
        uint256 repayment;
        uint64 maturity;
        uint64 duration;
        address currencyToken;
        address collateralToken;
        uint256 collateralTokenId;
    }

    /**************************************************************************/
    /* Primary API */
    /**************************************************************************/

    /**
     * @notice Get note token of lending platform
     * @return Note token contract
     */
    function noteToken() external view returns (IERC721);

    /**
     * @notice Get loan information
     * @param noteTokenId Note token ID
     * @return Loan information
     */
    function getLoanInfo(uint256 noteTokenId) external view returns (LoanInfo memory);

    /**
     * @notice Get target and calldata to liquidate loan
     * @param noteTokenId Note token ID
     * @return Target address
     * @return Encoded calldata with selector
     */
    function getLiquidateCalldata(uint256 noteTokenId) external view returns (address, bytes memory);

    /**
     * @notice Check if loan is supported by Vault
     * @param noteTokenId Note token ID
     * @param currencyToken Currency token used by Vault
     * @return True if supported, otherwise false
     */
    function isSupported(uint256 noteTokenId, address currencyToken) external view returns (bool);

    /**
     * @notice Check if loan is complete (repaid or liquidated)
     * @param noteTokenId Note token ID
     * @return True if complete, otherwise false
     */
    function isComplete(uint256 noteTokenId) external view returns (bool);
}
