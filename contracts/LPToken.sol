// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract LPToken is ERC20, Ownable {
    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
    }

    /**************************************************************************/
    /* Privileged API */
    /**************************************************************************/

    function mint(address to, uint256 amount) public virtual onlyOwner {
        _mint(to, amount);
    }

    function burn(address account, uint256 amount) public virtual onlyOwner {
        _burn(account, amount);
    }
}
