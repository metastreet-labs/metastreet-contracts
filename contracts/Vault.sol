// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "./interfaces/IVault.sol";
import "./LPToken.sol";

import "hardhat/console.sol";

contract VaultStorage {
    /* Structures */
    struct TrancheState {
        uint256 depositValue;
        uint256 pendingRedemptions;
        uint256 redemptionCounter;
        uint256 processedRedemptionCounter;
        mapping(uint64 => uint256) pendingReturns;
    }

    struct LoanState {
        uint256 purchasePrice;
        uint256 repayment;
        uint256[2] trancheReturns;
    }

    /* Parameters */
    uint256 public seniorTrancheRate;

    /* State */
    uint256 public totalLoanBalance;
    uint256 public totalCashBalance;
    uint256 public totalWithdrawalBalance;
    TrancheState[2] public tranches;
    mapping(address => mapping(uint256 => LoanState)) public loans;
}

contract Vault is Ownable, VaultStorage, IVault {
    using SafeERC20 for IERC20;

    /**************************************************************************/
    /* State */
    /**************************************************************************/

    /* Main state inherited from VaultStorage contract */

    string public override name;
    IERC20 public immutable override currencyToken;
    ILoanPriceOracle public override loanPriceOracle;
    mapping(address => INoteAdapter) public override noteAdapters;

    LPToken private immutable _seniorLPToken;
    LPToken private immutable _juniorLPToken;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    constructor(string memory vaultName, string memory lpSymbol, IERC20 currencyToken_, ILoanPriceOracle loanPriceOracle_) {
        name = vaultName;
        currencyToken = currencyToken_;

        string memory currencyTokenSymbol = IERC20Metadata(address(currencyToken)).name();
        _seniorLPToken = new LPToken("Senior LP Token", string(bytes.concat("msLP-", bytes(lpSymbol), "-", bytes(currencyTokenSymbol))));
        _juniorLPToken = new LPToken("Junior LP Token", string(bytes.concat("mjLP-", bytes(lpSymbol), "-", bytes(currencyTokenSymbol))));

        loanPriceOracle = loanPriceOracle_;
    }

    /**************************************************************************/
    /* Helper Functions */
    /**************************************************************************/

    function _lpToken(Tranche tranche) private view returns (LPToken) {
        return (tranche == Tranche.Senior) ? _seniorLPToken : _juniorLPToken;
    }

    /**************************************************************************/
    /* Getters */
    /**************************************************************************/

    function lpToken(Tranche tranche) public view returns (IERC20) {
        return IERC20(address(_lpToken(tranche)));
    }

    /**************************************************************************/
    /* Primary API */
    /**************************************************************************/

    function deposit(Tranche tranche, uint256 amount) public {
        console.log("deposit(tranche %s, amount %s)", uint(tranche), amount);

        /* Dummy deposit */
        currencyToken.safeTransferFrom(msg.sender, address(this), amount);
        _lpToken(tranche).mint(msg.sender, amount);

        /* FIXME */

        emit Deposited(msg.sender, tranche, amount, amount);
    }

    function depositMultiple(uint256[2] calldata amounts) public {
        if (amounts[0] > 0)
            deposit(Tranche.Senior, amounts[0]);

        if (amounts[1] > 0)
            deposit(Tranche.Junior, amounts[1]);
    }

    function sellNote(IERC721 noteToken, uint256 tokenId, uint256 purchasePrice) public {
        console.log("sellNote(noteToken %s, tokenId %s, purchasePrice %s)", address(noteToken), tokenId, purchasePrice);

        /* Dummy loan purchase */
        noteToken.safeTransferFrom(msg.sender, address(this), tokenId);
        currencyToken.safeTransfer(msg.sender, purchasePrice);

        /* FIXME */

        emit NotePurchased(msg.sender, address(noteToken), tokenId, purchasePrice);
    }

    function sellNoteAndDepositMultiple(IERC721 noteToken, uint256 tokenId, uint256[2] calldata amounts) public {
        console.log("sellNoteAndDeposit(noteToken %s, tokenId %s, amounts [%s, ...])", address(noteToken), tokenId, amounts[0]);

        /* Dummy loan purchase and deposit */
        noteToken.safeTransferFrom(msg.sender, address(this), tokenId);
        _lpToken(Tranche.Senior).mint(msg.sender, amounts[0]);
        _lpToken(Tranche.Junior).mint(msg.sender, amounts[1]);

        /* FIXME */

        emit NotePurchased(msg.sender, address(noteToken), tokenId, amounts[0] + amounts[1]);
        emit Deposited(msg.sender, Tranche.Senior, amounts[0], amounts[0]);
        emit Deposited(msg.sender, Tranche.Junior, amounts[1], amounts[1]);
    }

    function redeem(Tranche tranche, uint256 shares) public {
        console.log("redeem(tranche %s, shares %s)", uint(tranche), shares);

        /* Dummy redeem */
        _lpToken(tranche).burn(msg.sender, shares);

        /* FIXME */

        emit Redeemed(msg.sender, tranche, shares, shares);
    }

    function withdraw(Tranche tranche, uint256 amount) public {
        console.log("withdraw(tranche %s, amounts %s)", uint(tranche), amount);

        /* Dummy withdrawal */
        currencyToken.safeTransfer(msg.sender, amount);

        /* FIXME */

        emit Withdrawn(msg.sender, tranche, amount);
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
