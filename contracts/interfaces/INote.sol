// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface INote {
    /* Structures */
    struct LoanInfo {
        uint256 principal;
        uint256 repayment;
        uint64 startTime;
        uint32 duration;
        address currencyToken;
        address collateralToken;
        uint256 collateralTokenId;
    }

    /* Primary API */
    function promissoryNoteToken() external view returns (IERC721);

    function getLoanInfo(uint256 tokenId) external view returns (LoanInfo memory);
    function isSupported(uint256 tokenId, address currencyToken) external view returns (bool);
    function isActive(uint256 tokenId) external view returns (bool);
    function isRepaid(uint256 tokenId) external view returns (bool);
    function isDefaulted(uint256 tokenId) external view returns (bool);
}

