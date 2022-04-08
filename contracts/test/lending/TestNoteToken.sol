// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract TestNoteToken is ERC721, Ownable {
    constructor() ERC721("Test Promissory Note", "TPN") {}

    function mint(address to, uint256 tokenId) external virtual onlyOwner {
        _safeMint(to, tokenId);
    }

    function burn(uint256 tokenId) external virtual onlyOwner {
        _burn(tokenId);
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return _exists(tokenId);
    }
}
