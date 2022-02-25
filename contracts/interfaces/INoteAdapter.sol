// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface INoteAdapter {
    /* Structures */
    struct LoanInfo {
        address borrower;
        uint256 principal;
        uint256 repayment;
        uint64 maturity;
        uint32 duration;
        address currencyToken;
        address collateralToken;
        uint256 collateralTokenId;
    }

    /* Primary API */
    function noteToken() external view returns (IERC721);

    function lendingPlatform() external view returns (address);

    function getLoanInfo(uint256 tokenId) external view returns (LoanInfo memory);

    function getLiquidateCalldata(uint256 tokenId) external view returns (bytes memory);

    function isSupported(uint256 tokenId, address vaultCurrencyToken) external view returns (bool);

    function isActive(uint256 tokenId) external view returns (bool);

    function isComplete(uint256 tokenId) external view returns (bool);
}
