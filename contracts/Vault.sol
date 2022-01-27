// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

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

    function _computeSharePrice(Tranche tranche) internal view returns (uint256) {
        /* FIXME */
        return 100;
    }

    /**************************************************************************/
    /* Getters */
    /**************************************************************************/

    function lpToken(Tranche tranche) public view returns (IERC20) {
        return IERC20(address(_lpToken(tranche)));
    }

    function sharePrice(Tranche tranche) public view returns (uint256) {
        return _computeSharePrice(tranche);
    }

    /**************************************************************************/
    /* Internal Functions */
    /**************************************************************************/

    function _depositAndMint(Tranche tranche, uint256 amount) internal {
        tranches[uint(tranche)].depositValue += amount;
        totalCashBalance += amount;

        uint256 shares = amount / _computeSharePrice(tranche);
        _lpToken(tranche).mint(msg.sender, shares);

        emit Deposited(msg.sender, tranche, amount, shares);
    }

    /**************************************************************************/
    /* Primary API */
    /**************************************************************************/

    function deposit(Tranche tranche, uint256 amount) public {
        _depositAndMint(tranche, amount);
        currencyToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    function depositMultiple(uint256[2] calldata amounts) public {
        _depositAndMint(Tranche.Senior, amounts[0]);
        _depositAndMint(Tranche.Junior, amounts[1]);
        currencyToken.safeTransferFrom(msg.sender, address(this), amounts[0] + amounts[1]);
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
        TrancheState storage trancheState = tranches[uint(tranche)];

        uint256 redemptionAmount = shares * _computeSharePrice(tranche);

        trancheState.pendingRedemptions += redemptionAmount;
        trancheState.redemptionCounter += redemptionAmount;

        _lpToken(tranche).redeem(msg.sender, shares, redemptionAmount, trancheState.redemptionCounter);

        emit Redeemed(msg.sender, tranche, shares, redemptionAmount);
    }

    function withdraw(Tranche tranche, uint256 amount) public {
        TrancheState storage trancheState = tranches[uint(tranche)];

        totalWithdrawalBalance -= amount;

        _lpToken(tranche).withdraw(msg.sender, amount, trancheState.processedRedemptionCounter);

        currencyToken.safeTransfer(msg.sender, amount);

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
        seniorTrancheRate = interestRate;
        emit SeniorTrancheRateUpdated(interestRate);
    }

    function setLoanPriceOracle(address loanPriceOracle_) public onlyOwner {
        loanPriceOracle = ILoanPriceOracle(loanPriceOracle_);
        emit LoanPriceOracleUpdated(loanPriceOracle_);
    }

    function setNoteAdapter(address noteToken, address noteAdapter) public onlyOwner {
        noteAdapters[noteToken] = INoteAdapter(noteAdapter);
        emit NoteAdapterUpdated(noteToken, noteAdapter);
    }
}
