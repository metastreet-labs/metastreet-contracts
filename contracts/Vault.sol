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
    ILoanPriceOracle public override loanPriceOracle;
    mapping(address => INoteAdapter) public override noteAdapters;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    constructor(string memory vaultName, string memory lpSymbol, IERC20 currencyToken_, ILoanPriceOracle loanPriceOracle_) {
        name = vaultName;
        currencyToken = currencyToken_;

        string memory currencyTokenSymbol = IERC20Metadata(address(currencyToken)).name();
        seniorLPToken = new LPToken("Senior LP Token", string(bytes.concat("msLP-", bytes(lpSymbol), "-", bytes(currencyTokenSymbol))));
        juniorLPToken = new LPToken("Junior LP Token", string(bytes.concat("mjLP-", bytes(lpSymbol), "-", bytes(currencyTokenSymbol))));

        loanPriceOracle = loanPriceOracle_;
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

        emit Deposited(msg.sender, amounts, amounts);
    }

    function sellNote(IERC721 noteToken, uint256 tokenId, uint256 purchasePrice) public {
        console.log("sellNote(noteToken %s, tokenId %s, purchasePrice %s)", address(noteToken), tokenId, purchasePrice);

        /* Dummy loan purchase */
        noteToken.safeTransferFrom(msg.sender, address(this), tokenId);
        currencyToken.safeTransfer(msg.sender, purchasePrice);

        /* FIXME */

        emit NotePurchased(msg.sender, address(noteToken), tokenId, purchasePrice);
    }

    function sellNoteAndDeposit(IERC721 noteToken, uint256 tokenId, uint256[2] calldata amounts) public {
        console.log("sellNoteAndDeposit(noteToken %s, tokenId %s, amounts [%s, ...])", address(noteToken), tokenId, amounts[0]);

        /* Dummy loan purchase and deposit */
        noteToken.safeTransferFrom(msg.sender, address(this), tokenId);
        LPToken(address(seniorLPToken)).mint(msg.sender, amounts[0]);
        LPToken(address(juniorLPToken)).mint(msg.sender, amounts[1]);

        /* FIXME */

        emit NotePurchased(msg.sender, address(noteToken), tokenId, amounts[0] + amounts[1]);
        emit Deposited(msg.sender, amounts, amounts);
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

    function onLoanRepayment(IERC721 noteToken, uint256 tokenId) public {
        /* FIXME */
    }

    function onLoanDefault(IERC721 noteToken, uint256 tokenId) public {
        /* FIXME */
    }

    function onLoanLiquidated(IERC721 noteToken, uint256 tokenId, uint256 proceeds) public {
        /* FIXME */
    }

    /**************************************************************************/
    /* Setters */
    /**************************************************************************/

    function setSeniorTrancheRate(uint256 interestRate) public onlyOwner {
        console.log("setSeniorTrancheRate(interestRate %s)", interestRate);

        /* FIXME */

        emit SeniorTrancheRateUpdated(interestRate);
    }

    function setLoanPriceOracle(address loanPriceOracle_) public onlyOwner {
        console.log("setLoanPriceOracle(loanPriceOracle %s)", loanPriceOracle_);

        loanPriceOracle = ILoanPriceOracle(loanPriceOracle_);

        emit LoanPriceOracleUpdated(loanPriceOracle_);
    }

    function setNoteAdapter(address noteToken, address noteAdapter) public onlyOwner {
        console.log("setNoteAdapter(noteToken %s, noteAdapter %s)", noteToken, noteAdapter);

        noteAdapters[noteToken] = INoteAdapter(noteAdapter);

        emit NoteAdapterUpdated(noteToken, noteAdapter);
    }
}
