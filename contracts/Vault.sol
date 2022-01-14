// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "./interfaces/IVault.sol";
import "./LPToken.sol";

import "hardhat/console.sol";

contract Vault is IVault, Ownable {
    using SafeERC20 for IERC20;

    /**************************************************************************/
    /* State */
    /**************************************************************************/

    string public override name;
    IERC20 public immutable override currencyToken;
    IERC20 public immutable override seniorLPToken;
    IERC20 public immutable override juniorLPToken;
    IPriceOracle public override priceOracle;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    constructor(string memory vaultName, string memory lpSymbol, IERC20 currencyToken_, IPriceOracle priceOracle_) {
        name = vaultName;
        currencyToken = currencyToken_;

        string memory currencyTokenSymbol = IERC20Metadata(address(currencyToken)).name();
        seniorLPToken = new LPToken("Senior LP Token", string(bytes.concat("msLP-", bytes(lpSymbol), "-", bytes(currencyTokenSymbol))));
        juniorLPToken = new LPToken("Junior LP Token", string(bytes.concat("mjLP-", bytes(lpSymbol), "-", bytes(currencyTokenSymbol))));

        priceOracle = priceOracle_;
    }

    /**************************************************************************/
    /* Primary API */
    /**************************************************************************/

    function deposit(Tranche tranche, uint256 depositAmount) public {
        console.log("deposit(tranche %s, depositAmount %s)", uint8(tranche), depositAmount);

        LPToken lpToken = (tranche == Tranche.Senior) ? LPToken(address(seniorLPToken)) : LPToken(address(juniorLPToken));

        /* Dummy deposit */
        currencyToken.safeTransferFrom(msg.sender, address(this), depositAmount);
        lpToken.mint(msg.sender, depositAmount);

        /* FIXME */

        emit Deposited(msg.sender, tranche, depositAmount);
    }

    function sellNote(IERC721 promissoryToken, uint256 tokenId, uint256 purchasePrice) public {
        console.log("sellNote(promissoryToken %s, tokenId %s, purchasePrice %s)", address(promissoryToken), tokenId, purchasePrice);

        /* Dummy loan purchase */
        promissoryToken.safeTransferFrom(msg.sender, address(this), tokenId);
        currencyToken.safeTransfer(msg.sender, purchasePrice);

        /* FIXME */

        emit NotePurchased(msg.sender, address(promissoryToken), tokenId, purchasePrice);
    }

    function sellNoteAndDeposit(IERC721 promissoryToken, uint256 tokenId, uint256 purchasePrice, Tranche tranche) public {
        console.log("sellNoteAndDeposit(promissoryToken %s, tokenId %s, purchasePrice %s, ...)", address(promissoryToken), tokenId, purchasePrice);

        LPToken lpToken = (tranche == Tranche.Senior) ? LPToken(address(seniorLPToken)) : LPToken(address(juniorLPToken));

        /* Dummy loan purchase and deposit */
        promissoryToken.safeTransferFrom(msg.sender, address(this), tokenId);
        lpToken.mint(msg.sender, purchasePrice);

        /* FIXME */

        emit NotePurchased(msg.sender, address(promissoryToken), tokenId, purchasePrice);
        emit Deposited(msg.sender, tranche, purchasePrice);
    }

    function redeem(Tranche tranche, uint256 shares) public {
        console.log("redeem(tranche %s, shares %s)", uint8(tranche), shares);

        LPToken lpToken = (tranche == Tranche.Senior) ? LPToken(address(seniorLPToken)) : LPToken(address(juniorLPToken));

        /* Dummy redeem */
        lpToken.burn(msg.sender, shares);

        /* FIXME */

        emit Redeemed(msg.sender, tranche, shares, shares);
    }

    function withdraw(Tranche tranche, uint256 amount) public {
        console.log("withdraw(tranche %s, amount %s)", uint8(tranche), amount);

        /* Dummy withdrawal */
        currencyToken.safeTransfer(msg.sender, amount);

        /* FIXME */

        emit Withdrawn(msg.sender, tranche, amount);
    }

    /**************************************************************************/
    /* Callbacks */
    /**************************************************************************/

    function onLoanRepayment(IERC721 promissoryToken, uint256 tokenId) public {
        /* FIXME */
    }

    function onLoanDefault(IERC721 promissoryToken, uint256 tokenId) public {
        /* FIXME */
    }

    function onLoanLiquidated(IERC721 promissoryToken, uint256 tokenId, uint256 proceeds) public {
        /* FIXME */
    }

    /**************************************************************************/
    /* Setters */
    /**************************************************************************/

    function setTrancheRate(Tranche tranche, uint256 interestRate) public onlyOwner {
        console.log("setTrancheRate(tranche %s, interestRate %s)", uint8(tranche), interestRate);

        /* FIXME */

        emit TrancheRateUpdated(tranche, interestRate);
    }

    function setPriceOracle(address priceOracle_) public onlyOwner {
        console.log("setPriceOracle(priceOracle %s)", priceOracle_);

        priceOracle = IPriceOracle(priceOracle_);

        emit PriceOracleUpdated(priceOracle_);
    }
}
