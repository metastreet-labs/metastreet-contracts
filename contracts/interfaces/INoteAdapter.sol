// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface INoteAdapter {
    /* Structures */
    struct LoanInfo {
        address borrower;
        uint256 principal;
        uint256 repayment;
        uint256 startTime;
        uint32 duration;
        address currencyToken;
        address collateralToken;
        uint256 collateralTokenId;
    }

    /* Primary API */
    function promissoryNoteToken() external view returns (IERC721);

    function getLoanInfo(uint256 tokenId) external view returns (LoanInfo memory);
    function isSupported(uint256 tokenId, address vaultCurrencyToken) external view returns (bool);
    function isActive(uint256 tokenId) external view returns (bool);
    function isComplete(uint256 tokenId) external view returns (bool);
}

