// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract TestERC721 is ERC721 {
    address public immutable owner;
    string private _baseTokenURI;

    constructor(string memory name, string memory symbol, string memory baseURI) ERC721(name, symbol) {
        owner = msg.sender;
        _baseTokenURI = baseURI;
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    function mint(address to, uint256 tokenId) public virtual {
        require(msg.sender == owner, "This function is restricted to the owner");
        _safeMint(to, tokenId);
    }
}
