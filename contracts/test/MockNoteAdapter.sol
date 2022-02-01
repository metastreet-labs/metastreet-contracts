// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "contracts/interfaces/INoteAdapter.sol";

contract MockNoteAdapter is INoteAdapter {
    bool private _supported;
    bool private _active;
    bool private _complete;

    constructor() {}

    function noteToken() public pure returns (IERC721) {
        return IERC721(address(0x0));
    }

    function lendingPlatform() public pure returns (address) {
        return address(0x0);
    }

    function getLoanInfo(uint256 tokenId) public pure returns (LoanInfo memory) {
        tokenId;

        LoanInfo memory loanInfo;
        return loanInfo;
    }

    function isSupported(uint256 tokenId, address vaultCurrencyToken) public view returns (bool) {
        tokenId;
        vaultCurrencyToken;

        return _supported;
    }

    function isActive(uint256 tokenId) public view returns (bool) {
        tokenId;

        return _active;
    }

    function isComplete(uint256 tokenId) public view returns (bool) {
        tokenId;

        return _complete;
    }

    function setState(
        bool supported,
        bool active,
        bool complete
    ) public {
        _supported = supported;
        _active = active;
        _complete = complete;
    }
}
