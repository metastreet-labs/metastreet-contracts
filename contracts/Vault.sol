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

    function deposit(uint256[2] calldata amounts) public {
        console.log("deposit(amounts [%s, %s])", amounts[0], amounts[1]);

        /* Dummy deposit */
        currencyToken.safeTransferFrom(msg.sender, address(this), amounts[0] + amounts[1]);
        LPToken(address(seniorLPToken)).mint(msg.sender, amounts[0]);
        LPToken(address(juniorLPToken)).mint(msg.sender, amounts[1]);

        /* FIXME */

        emit Deposited(msg.sender, amounts);
    }

    function sellNote(IERC721 promissoryToken, uint256 tokenId, uint256 purchasePrice) public {
        console.log("sellNote(promissoryToken %s, tokenId %s, purchasePrice %s)", address(promissoryToken), tokenId, purchasePrice);

        /* Dummy loan purchase */
        promissoryToken.safeTransferFrom(msg.sender, address(this), tokenId);
        currencyToken.safeTransfer(msg.sender, purchasePrice);

        /* FIXME */

        emit NotePurchased(msg.sender, address(promissoryToken), tokenId, purchasePrice);
    }

    function sellNoteAndDeposit(IERC721 promissoryToken, uint256 tokenId, uint256[2] calldata amounts) public {
        console.log("sellNoteAndDeposit(promissoryToken %s, tokenId %s, amounts [%s, ...])", address(promissoryToken), tokenId, amounts[0]);

        /* Dummy loan purchase and deposit */
        promissoryToken.safeTransferFrom(msg.sender, address(this), tokenId);
        LPToken(address(seniorLPToken)).mint(msg.sender, amounts[0]);
        LPToken(address(juniorLPToken)).mint(msg.sender, amounts[1]);

        /* FIXME */

        emit NotePurchased(msg.sender, address(promissoryToken), tokenId, amounts[0] + amounts[1]);
        emit Deposited(msg.sender, amounts);
    }

    function redeem(uint256[2] calldata shares) public {
        console.log("redeem(shares [%s, %s])", shares[0], shares[1]);

        /* Dummy redeem */
        LPToken(address(seniorLPToken)).burn(msg.sender, shares[0]);
        LPToken(address(juniorLPToken)).burn(msg.sender, shares[1]);

        /* FIXME */

        emit Redeemed(msg.sender, shares, shares);
    }

    function withdraw(uint256[2] calldata amounts) public {
        console.log("withdraw(amounts [%s, %s])", amounts[0], amounts[1]);

        /* Dummy withdrawal */
        currencyToken.safeTransfer(msg.sender, amounts[0] + amounts[1]);

        /* FIXME */

        emit Withdrawn(msg.sender, amounts);
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
