// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

interface ILoanReceiver {
    function onLoanRepaid(address noteToken, uint256 tokenId) external;
}
