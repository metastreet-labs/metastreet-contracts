// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "prb-math/contracts/PRBMathUD60x18.sol";

import "./interfaces/IVault.sol";
import "./LPToken.sol";

contract VaultState {
    /* Structures */
    struct Tranche {
        uint256 depositValue;
        uint256 pendingRedemptions;
        uint256 redemptionQueue;
        uint256 processedRedemptionQueue;
        mapping(uint64 => uint256) pendingReturns;
    }

    struct Tranches {
        Tranche senior;
        Tranche junior;
    }

    struct Loan {
        IERC721 collateralToken;
        uint256 collateralTokenId;
        uint256 purchasePrice;
        uint256 repayment;
        uint64 maturity;
        bool liquidated;
        uint256[2] trancheReturns;
    }

    /* Parameters */
    uint256 public seniorTrancheRate; /* UD60x18, in amount per seconds */

    /* State */
    Tranches internal _tranches;
    uint256 public totalLoanBalance;
    uint256 public totalCashBalance;
    uint256 public totalWithdrawalBalance;
    mapping(address => mapping(uint256 => Loan)) public loans;
}

contract Vault is Ownable, VaultState, IVault {
    using SafeERC20 for IERC20;

    /**************************************************************************/
    /* Constants */
    /**************************************************************************/

    uint64 public constant TIME_BUCKET_DURATION = 7 days;
    uint256 public constant SHARE_PRICE_PRORATION_BUCKETS = 6;

    /**************************************************************************/
    /* State */
    /**************************************************************************/

    /* Main state inherited from VaultState contract */

    string public override name;
    IERC20 public immutable override currencyToken;
    ILoanPriceOracle public override loanPriceOracle;
    address public override collateralLiquidator;
    mapping(address => INoteAdapter) public override noteAdapters;

    LPToken private immutable _seniorLPToken;
    LPToken private immutable _juniorLPToken;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    constructor(
        string memory vaultName,
        string memory lpSymbol,
        IERC20 currencyToken_,
        ILoanPriceOracle loanPriceOracle_
    ) {
        name = vaultName;
        currencyToken = currencyToken_;
        loanPriceOracle = loanPriceOracle_;

        IERC20Metadata currencyTokenMetadata = IERC20Metadata(address(currencyToken));
        require(currencyTokenMetadata.decimals() == 18, "Unsupported token decimals");

        /* Create senior and junior tranche LP Tokens */
        string memory currencyTokenSymbol = currencyTokenMetadata.symbol();
        _seniorLPToken = new LPToken(
            "Senior LP Token",
            string(bytes.concat("msLP-", bytes(lpSymbol), "-", bytes(currencyTokenSymbol)))
        );
        _juniorLPToken = new LPToken(
            "Junior LP Token",
            string(bytes.concat("mjLP-", bytes(lpSymbol), "-", bytes(currencyTokenSymbol)))
        );
    }

    /**************************************************************************/
    /* Getters */
    /**************************************************************************/

    function lpToken(TrancheId trancheId) public view returns (IERC20) {
        return IERC20(address(_lpToken(trancheId)));
    }

    function trancheState(TrancheId trancheId)
        public
        view
        returns (
            uint256 depositValue,
            uint256 pendingRedemptions,
            uint256 redemptionQueue,
            uint256 processedRedemptionQueue
        )
    {
        Tranche storage tranche = _trancheState(trancheId);
        return (
            tranche.depositValue,
            tranche.pendingRedemptions,
            tranche.redemptionQueue,
            tranche.processedRedemptionQueue
        );
    }

    function sharePrice(TrancheId trancheId) public view returns (uint256) {
        return _computeSharePrice(trancheId);
    }

    /**************************************************************************/
    /* Internal Helper Functions */
    /**************************************************************************/

    function _lpToken(TrancheId trancheId) internal view returns (LPToken) {
        return (trancheId == TrancheId.Senior) ? _seniorLPToken : _juniorLPToken;
    }

    function _trancheState(TrancheId trancheId) internal view returns (Tranche storage) {
        return (trancheId == TrancheId.Senior) ? _tranches.senior : _tranches.junior;
    }

    function _timestampToTimeBucket(uint64 timestamp) internal pure returns (uint64) {
        return timestamp / TIME_BUCKET_DURATION;
    }

    function _timeBucketToTimestamp(uint64 timeBucket) internal pure returns (uint64) {
        return timeBucket * TIME_BUCKET_DURATION;
    }

    function _computeEstimatedValue(TrancheId trancheId) internal view returns (uint256) {
        Tranche storage tranche = _trancheState(trancheId);

        /* Get the current time bucket */
        uint64 currentTimeBucket = _timestampToTimeBucket(uint64(block.timestamp));

        /* Compute elapsed time into current time bucket and convert to UD60x18 */
        uint256 elapsedTime = PRBMathUD60x18.fromUint(block.timestamp - _timeBucketToTimestamp(currentTimeBucket));

        /* Sum the prorated returns from pending returns in each time bucket */
        uint256 proratedReturns;
        for (uint256 i = 0; i < SHARE_PRICE_PRORATION_BUCKETS; i++) {
            proratedReturns += PRBMathUD60x18.div(
                PRBMathUD60x18.mul(elapsedTime, tranche.pendingReturns[currentTimeBucket + uint64(i)]),
                PRBMathUD60x18.fromUint(TIME_BUCKET_DURATION) * (i + 1)
            );
        }

        /* Return the deposit value plus prorated returns */
        return tranche.depositValue + proratedReturns;
    }

    function _computeSharePrice(TrancheId trancheId) internal view returns (uint256) {
        uint256 estimatedValue = _computeEstimatedValue(trancheId);
        return (estimatedValue == 0) ? 1e18 : PRBMathUD60x18.div(estimatedValue, _lpToken(trancheId).totalSupply());
    }

    function _processRedemptions(Tranche storage tranche, uint256 proceeds) internal returns (uint256) {
        /* Compute maximum redemption possible */
        uint256 redemptionAmount = Math.min(tranche.pendingRedemptions, proceeds);

        /* Update tranche redemption state */
        tranche.pendingRedemptions -= redemptionAmount;
        tranche.processedRedemptionQueue += redemptionAmount;
        tranche.depositValue -= redemptionAmount;

        /* Move redemption from cash to withdrawal balance */
        totalCashBalance -= redemptionAmount;
        totalWithdrawalBalance += redemptionAmount;

        /* Return amount of cash leftover (for further tranche redemptions) */
        return proceeds - redemptionAmount;
    }

    function _deposit(TrancheId trancheId, uint256 amount) internal {
        /* Compute number of shares to mint from current tranche share price */
        uint256 shares = PRBMathUD60x18.div(amount, _computeSharePrice(trancheId));

        /* Increase deposit value of tranche */
        _trancheState(trancheId).depositValue += amount;

        /* Increase total cash balance */
        totalCashBalance += amount;

        /* Mint LP tokens to user */
        _lpToken(trancheId).mint(msg.sender, shares);

        emit Deposited(msg.sender, trancheId, amount, shares);
    }

    function _sellNote(
        IERC721 noteToken,
        uint256 tokenId,
        uint256 purchasePrice
    ) internal {
        INoteAdapter noteAdapter = noteAdapters[address(noteToken)];

        /* Validate note token is supported */
        require(noteAdapter != INoteAdapter(address(0x0)), "Unsupported note");

        /* Check if loan parameters are supported */
        require(noteAdapter.isSupported(tokenId, address(currencyToken)), "Unsupported note parameters");

        /* Get loan info */
        INoteAdapter.LoanInfo memory loanInfo = noteAdapter.getLoanInfo(tokenId);

        /* Get loan purchase price */
        uint256 loanPurchasePrice = loanPriceOracle.priceLoan(
            loanInfo.collateralToken,
            loanInfo.collateralTokenId,
            loanInfo.principal,
            loanInfo.repayment,
            loanInfo.duration,
            loanInfo.maturity
        );

        /* Validate purchase price */
        require(purchasePrice == loanPurchasePrice, "Invalid purchase price");

        /* Validate repayment */
        require(loanInfo.repayment > purchasePrice, "Purchase price too high");

        /* Validate cash available */
        require(totalCashBalance >= purchasePrice, "Insufficient cash in vault");

        /* Calculate tranche contribution based on their deposit proportion */
        /* Senior Tranche Contribution = (D_s / (D_s + D_j)) * Purchase Price */
        uint256 seniorTrancheContribution = PRBMathUD60x18.div(
            PRBMathUD60x18.mul(_tranches.senior.depositValue, purchasePrice),
            _tranches.senior.depositValue + _tranches.junior.depositValue
        );

        /* Calculate senior tranche return */
        /* Senior Tranche Return = Senior Tranche Contribution * (1 + r * t) */
        uint256 loanTimeRemaining = loanInfo.maturity - block.timestamp;
        uint256 seniorTrancheReturn = PRBMathUD60x18.mul(
            seniorTrancheContribution,
            1e18 + PRBMathUD60x18.mul(seniorTrancheRate, loanTimeRemaining)
        );

        /* Validate senior tranche return */
        require(seniorTrancheReturn < (loanInfo.repayment - purchasePrice), "Senior tranche return too low");

        /* Calculate junior tranche return */
        /* Junior Tranche Return = Repayment - Purchase Price - Senior Tranche Return */
        uint256 juniorTrancheReturn = loanInfo.repayment - purchasePrice - seniorTrancheReturn;

        /* Compute loan maturity time bucket */
        uint64 loanMaturityTimeBucket = _timestampToTimeBucket(loanInfo.maturity);

        /* Schedule pending tranche returns */
        _tranches.senior.pendingReturns[loanMaturityTimeBucket] += seniorTrancheReturn;
        _tranches.junior.pendingReturns[loanMaturityTimeBucket] += juniorTrancheReturn;

        /* Update global cash and loan balances */
        totalCashBalance -= purchasePrice;
        totalLoanBalance += purchasePrice;

        /* Store loan state */
        Loan storage loan = loans[address(noteToken)][tokenId];
        loan.collateralToken = IERC721(loanInfo.collateralToken);
        loan.collateralTokenId = loanInfo.collateralTokenId;
        loan.purchasePrice = purchasePrice;
        loan.repayment = loanInfo.repayment;
        loan.maturity = loanInfo.maturity;
        loan.liquidated = false;
        loan.trancheReturns = [seniorTrancheReturn, juniorTrancheReturn];

        emit NotePurchased(msg.sender, address(noteToken), tokenId, purchasePrice);
    }

    /**************************************************************************/
    /* User API */
    /**************************************************************************/

    function deposit(TrancheId trancheId, uint256 amount) public {
        /* Deposit into tranche */
        _deposit(trancheId, amount);

        /* Transfer cash from user to vault */
        currencyToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    function depositMultiple(uint256[2] calldata amounts) public {
        /* Deposit into tranches */
        _deposit(TrancheId.Senior, amounts[0]);
        _deposit(TrancheId.Junior, amounts[1]);

        /* Transfer total cash from user to vault */
        currencyToken.safeTransferFrom(msg.sender, address(this), amounts[0] + amounts[1]);
    }

    function sellNote(
        IERC721 noteToken,
        uint256 tokenId,
        uint256 purchasePrice
    ) public {
        /* Purchase the note */
        _sellNote(noteToken, tokenId, purchasePrice);

        /* Transfer promissory note from user to vault */
        noteToken.safeTransferFrom(msg.sender, address(this), tokenId);

        /* Transfer cash from vault to user */
        currencyToken.safeTransfer(msg.sender, purchasePrice);
    }

    function sellNoteBatch(
        IERC721[] calldata noteToken,
        uint256[] calldata tokenId,
        uint256[] calldata amounts
    ) public {
        /* Validate arrays are all of the same length */
        require((noteToken.length == tokenId.length) && (noteToken.length == amounts.length), "Invalid parameters");

        for (uint256 i = 0; i < noteToken.length; i++) {
            sellNote(noteToken[i], tokenId[i], amounts[i]);
        }
    }

    function sellNoteAndDeposit(
        IERC721 noteToken,
        uint256 tokenId,
        uint256[2] calldata amounts
    ) public {
        /* Calculate total purchase price */
        uint256 purchasePrice = amounts[0] + amounts[1];

        /* Purchase the note */
        _sellNote(noteToken, tokenId, purchasePrice);

        /* Deposit sale proceeds in tranches */
        if (amounts[0] > 0) _deposit(TrancheId.Senior, amounts[0]);
        if (amounts[1] > 0) _deposit(TrancheId.Junior, amounts[1]);

        /* Transfer promissory note from user to vault */
        noteToken.safeTransferFrom(msg.sender, address(this), tokenId);
    }

    function sellNoteAndDepositBatch(
        IERC721[] calldata noteToken,
        uint256[] calldata tokenId,
        uint256[2][] calldata amounts
    ) public {
        /* Validate arrays are all of the same length */
        require((noteToken.length == tokenId.length) && (noteToken.length == amounts.length), "Invalid parameters");

        for (uint256 i = 0; i < noteToken.length; i++) {
            sellNoteAndDeposit(noteToken[i], tokenId[i], amounts[i]);
        }
    }

    function redeem(TrancheId trancheId, uint256 shares) public {
        Tranche storage tranche = _trancheState(trancheId);

        /* Compute redemption amount */
        uint256 redemptionAmount = PRBMathUD60x18.mul(shares, _computeSharePrice(trancheId));

        /* Schedule redemption in tranche */
        tranche.pendingRedemptions += redemptionAmount;
        tranche.redemptionQueue += redemptionAmount;

        /* Schedule redemption with user's token state and burn LP tokens */
        _lpToken(trancheId).redeem(msg.sender, shares, redemptionAmount, tranche.redemptionQueue);

        emit Redeemed(msg.sender, trancheId, shares, redemptionAmount);
    }

    function withdraw(TrancheId trancheId, uint256 amount) public {
        Tranche storage tranche = _trancheState(trancheId);

        /* Update user's token state with redemption */
        _lpToken(trancheId).withdraw(msg.sender, amount, tranche.processedRedemptionQueue);

        /* Decrease global withdrawal balance */
        totalWithdrawalBalance -= amount;

        /* Transfer cash from vault to user */
        currencyToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, trancheId, amount);
    }

    function withdrawCollateral(IERC721 noteToken, uint256 tokenId) public {
        /* Validate caller is collateral liquidation contract */
        require(msg.sender == collateralLiquidator, "Invalid caller");

        /* Lookup loan metadata */
        Loan storage loan = loans[address(noteToken)][tokenId];

        /* Validate loan exists with contract */
        require(loan.purchasePrice != 0, "Unknown loan");

        /* Validate loan was liquidated */
        require(loan.liquidated, "Loan not liquidated");

        /* Transfer collateral to liquidator */
        loan.collateralToken.safeTransferFrom(address(this), collateralLiquidator, loan.collateralTokenId);

        emit CollateralWithdrawn(
            address(noteToken),
            tokenId,
            address(loan.collateralToken),
            loan.collateralTokenId,
            collateralLiquidator
        );
    }

    /**************************************************************************/
    /* Callbacks */
    /**************************************************************************/

    function onLoanRepaid(IERC721 noteToken, uint256 tokenId) public {
        INoteAdapter noteAdapter = noteAdapters[address(noteToken)];

        /* Validate note token is supported */
        require(noteAdapter != INoteAdapter(address(0x0)), "Unsupported note");

        /* Lookup loan state */
        Loan storage loan = loans[address(noteToken)][tokenId];

        /* Validate loan exists with contract */
        require(loan.purchasePrice != 0, "Unknown loan");

        /* Validate loan was repaid, either because caller is the lending
         * platform (trusted), or by checking the loan is complete and the
         * collateral is not in contract's possession (trustless) */
        bool loanRepaid = (msg.sender == noteAdapter.lendingPlatform()) ||
            (noteAdapter.isComplete(tokenId) && loan.collateralToken.ownerOf(loan.collateralTokenId) != address(this));
        require(loanRepaid, "Loan not repaid");

        /* Compute loan maturity time bucket */
        uint64 loanMaturityTimeBucket = _timestampToTimeBucket(loan.maturity);

        /* Unschedule pending returns */
        _tranches.senior.pendingReturns[loanMaturityTimeBucket] -= loan.trancheReturns[uint256(TrancheId.Senior)];
        _tranches.junior.pendingReturns[loanMaturityTimeBucket] -= loan.trancheReturns[uint256(TrancheId.Junior)];

        /* Increase tranche deposit values */
        _tranches.senior.depositValue += loan.trancheReturns[uint256(TrancheId.Senior)];
        _tranches.junior.depositValue += loan.trancheReturns[uint256(TrancheId.Junior)];

        /* Decrease total loan and cash balances */
        totalLoanBalance -= loan.purchasePrice;
        totalCashBalance += loan.repayment;

        /* Process redemptions for both tranches */
        uint256 proceeds = loan.repayment;
        proceeds = _processRedemptions(_tranches.senior, proceeds);
        _processRedemptions(_tranches.junior, proceeds);

        /* Delete loan metadata */
        delete loans[address(noteToken)][tokenId];
    }

    function onLoanLiquidated(IERC721 noteToken, uint256 tokenId) public {
        INoteAdapter noteAdapter = noteAdapters[address(noteToken)];

        /* Validate note token is supported */
        require(noteAdapter != INoteAdapter(address(0x0)), "Unsupported note");

        /* Lookup loan metadata */
        Loan storage loan = loans[address(noteToken)][tokenId];

        /* Validate loan exists with contract */
        require(loan.purchasePrice != 0, "Unknown loan");

        /* Validate loan was liquidated, either because caller is the lending
         * platform (trusted), or by checking the loan is complete and the
         * collateral is in the contract's possession (trustless) */
        bool loanLiquidated = (msg.sender == noteAdapter.lendingPlatform()) ||
            (noteAdapter.isComplete(tokenId) && loan.collateralToken.ownerOf(loan.collateralTokenId) == address(this));
        require(loanLiquidated, "Loan not liquidated");

        /* Validate loan liquidation wasn't already processed */
        require(!loan.liquidated, "Loan liquidation processed");

        /* Compute loan maturity time bucket */
        uint64 loanMaturityTimeBucket = _timestampToTimeBucket(loan.maturity);

        /* Unschedule pending returns */
        _tranches.senior.pendingReturns[loanMaturityTimeBucket] -= loan.trancheReturns[uint256(TrancheId.Senior)];
        _tranches.junior.pendingReturns[loanMaturityTimeBucket] -= loan.trancheReturns[uint256(TrancheId.Junior)];

        /* Compute tranche losses */
        uint256 juniorTrancheLoss = Math.max(loan.purchasePrice, _tranches.junior.depositValue);
        uint256 seniorTrancheLoss = loan.purchasePrice - juniorTrancheLoss;

        /* Decrease tranche deposit values */
        _tranches.senior.depositValue -= seniorTrancheLoss;
        _tranches.junior.depositValue -= juniorTrancheLoss;

        /* Decrease total loan balance */
        totalLoanBalance -= loan.purchasePrice;

        /* Update tranche returns for collateral liquidation */
        loan.trancheReturns[uint256(TrancheId.Senior)] += seniorTrancheLoss;
        loan.trancheReturns[uint256(TrancheId.Junior)] = 0;

        /* Mark loan liquidated in loan state */
        loan.liquidated = true;
    }

    function onCollateralLiquidated(
        IERC721 noteToken,
        uint256 tokenId,
        uint256 proceeds
    ) public {
        /* Validate caller is collateral liquidation contract */
        require(msg.sender == collateralLiquidator, "Invalid caller");

        /* Lookup loan metadata */
        Loan storage loan = loans[address(noteToken)][tokenId];

        /* Validate loan exists with contract */
        require(loan.purchasePrice != 0, "Unknown loan");

        /* Validate loan was liquidated */
        require(loan.liquidated, "Loan not liquidated");

        /* Compute tranche repayments */
        uint256 seniorTrancheRepayment = Math.min(proceeds, loan.trancheReturns[uint256(TrancheId.Senior)]);
        uint256 juniorTrancheRepayment = proceeds - seniorTrancheRepayment;

        /* Increase tranche deposit values */
        _tranches.senior.depositValue += seniorTrancheRepayment;
        _tranches.junior.depositValue += juniorTrancheRepayment;

        /* Increase total cash balance */
        totalCashBalance += proceeds;

        /* Process redemptions for both tranches */
        proceeds = _processRedemptions(_tranches.senior, proceeds);
        _processRedemptions(_tranches.junior, proceeds);

        /* Delete loan metadata */
        delete loans[address(noteToken)][tokenId];
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

    function setCollateralLiquidator(address collateralLiquidator_) public onlyOwner {
        collateralLiquidator = collateralLiquidator_;
        emit CollateralLiquidatorUpdated(collateralLiquidator_);
    }

    function setNoteAdapter(address noteToken, address noteAdapter) public onlyOwner {
        noteAdapters[noteToken] = INoteAdapter(noteAdapter);
        emit NoteAdapterUpdated(noteToken, noteAdapter);
    }
}
