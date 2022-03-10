// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "prb-math/contracts/PRBMathUD60x18.sol";

import "./interfaces/IVault.sol";
import "./LPToken.sol";

/**
 * @title Storage for Vault, V1
 */
abstract contract VaultStorageV1 {
    /**************************************************************************/
    /* Structures */
    /**************************************************************************/

    /**
     * @notice Tranche state
     * @param depositValue Deposit value
     * @param pendingRedemptions Pending redemptions
     * @param redemptionQueue Current redemption queue
     * @param processedRedemptionQueue Processed redemption queue
     * @param pendingReturns Mapping of time bucket to pending returns
     */
    struct Tranche {
        uint256 depositValue;
        uint256 pendingRedemptions;
        uint256 redemptionQueue;
        uint256 processedRedemptionQueue;
        mapping(uint64 => uint256) pendingReturns;
    }

    /**
     * @notice Tranches
     * @param senior Senior tranche
     * @param junior Junior tranche
     */
    struct Tranches {
        Tranche senior;
        Tranche junior;
    }

    /**
     * @notice Loan state
     * @param active Loan is active
     * @param collateralToken Collateral token contract
     * @param collateralTokenId Collateral token ID
     * @param purchasePrice Purchase price in currency tokens
     * @param repayment Repayment in currency tokens
     * @param maturity Maturity in seconds since Unix epoch
     * @param liquidated Loan is liquidated
     * @param trancheReturns Tranche returns in currency tokens
     */
    struct Loan {
        bool active;
        IERC721 collateralToken;
        uint256 collateralTokenId;
        uint256 purchasePrice;
        uint256 repayment;
        uint64 maturity;
        bool liquidated;
        uint256[2] trancheReturns;
    }

    /**************************************************************************/
    /* Properties and Linked Contracts */
    /**************************************************************************/

    string internal _name;
    IERC20 internal _currencyToken;
    ILoanPriceOracle internal _loanPriceOracle;
    address internal _collateralLiquidator;
    mapping(address => INoteAdapter) internal _noteAdapters;
    LPToken internal _seniorLPToken;
    LPToken internal _juniorLPToken;
    mapping(bytes4 => bool) internal _supportedInterfaces;

    /**************************************************************************/
    /* Parameters */
    /**************************************************************************/

    /**
     * @dev Senior tranche rate in UD60x18 amount per seconds
     */
    uint256 internal _seniorTrancheRate;

    /**
     * @dev Reserve ration in UD60x18
     */
    uint256 internal _reserveRatio;

    /**************************************************************************/
    /* State */
    /**************************************************************************/

    Tranches internal _tranches;
    uint256 internal _totalLoanBalance;
    uint256 internal _totalCashBalance;
    uint256 internal _totalWithdrawalBalance;

    /**
     * @dev Mapping of note token contract to note token ID to loan
     */
    mapping(address => mapping(uint256 => Loan)) internal _loans;
}

/**
 * @title Storage for Vault, aggregated
 */
abstract contract VaultStorage is VaultStorageV1 {

}

/**
 * @title Vault
 */
contract Vault is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    VaultStorage,
    IERC165,
    IERC721Receiver,
    IVault
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**************************************************************************/
    /* Constants */
    /**************************************************************************/

    /**
     * @notice Implementation version
     */
    string public constant IMPLEMENTATION_VERSION = "1.0";

    /**
     * @notice Time bucket duration in seconds
     */
    uint64 public constant TIME_BUCKET_DURATION = 14 days;

    /**
     * @notice Number of share price proration buckets
     */
    uint64 public constant SHARE_PRICE_PRORATION_BUCKETS = 6;

    /**
     * @notice Total share price proration window in seconds
     */
    uint64 public constant TOTAL_SHARE_PRICE_PRORATION_DURATION = TIME_BUCKET_DURATION * SHARE_PRICE_PRORATION_BUCKETS;

    /**************************************************************************/
    /* Events */
    /**************************************************************************/

    /**
     * @notice Emitted when senior tranche rate is updated
     * @param rate New senior tranche rate in UD60x18 amount per second
     */
    event SeniorTrancheRateUpdated(uint256 rate);

    /**
     * @notice Emitted when cash reserve ratio is updated
     * @param ratio New cash reserve ratio in UD60x18
     */
    event ReserveRatioUpdated(uint256 ratio);

    /**
     * @notice Emitted when loan price oracle contract is updated
     * @param loanPriceOracle New loan price oracle contract
     */
    event LoanPriceOracleUpdated(address loanPriceOracle);

    /**
     * @notice Emitted when collateral liquidator contract is updated
     * @param collateralLiquidator New collateral liquidator contract
     */
    event CollateralLiquidatorUpdated(address collateralLiquidator);

    /**
     * @notice Emitted when note adapter is updated
     * @param noteToken Note token contract
     * @param noteAdapter Note adapter contract
     */
    event NoteAdapterUpdated(address noteToken, address noteAdapter);

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    /**
     * @notice Vault constructor (for proxy)
     * @param name_ Vault name
     * @param currencyToken_ Currency token contract
     * @param loanPriceOracle_ Loan price oracle contract
     * @param seniorLPToken_ Senior LP token contract
     * @param juniorLPToken_ Junior LP token contract
     */
    function initialize(
        string memory name_,
        IERC20 currencyToken_,
        ILoanPriceOracle loanPriceOracle_,
        LPToken seniorLPToken_,
        LPToken juniorLPToken_
    ) external initializer {
        require(IERC20Metadata(address(currencyToken_)).decimals() == 18, "Unsupported token decimals");

        __Ownable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        _name = name_;
        _currencyToken = currencyToken_;
        _loanPriceOracle = loanPriceOracle_;
        _seniorLPToken = seniorLPToken_;
        _juniorLPToken = juniorLPToken_;

        /* Populate ERC165 supported interfaces */
        _supportedInterfaces[this.supportsInterface.selector] = true;
        _supportedInterfaces[IERC721Receiver.onERC721Received.selector] = true;
        _supportedInterfaces[ILoanReceiver.onLoanRepaid.selector] = true;
        _supportedInterfaces[ILoanReceiver.onLoanLiquidated.selector] = true;
    }

    /**************************************************************************/
    /* Interface Getters (defined in IVault) */
    /**************************************************************************/

    /**
     * @inheritdoc IVault
     */
    function name() external view returns (string memory) {
        return _name;
    }

    /**
     * @inheritdoc IVault
     */
    function currencyToken() external view returns (IERC20) {
        return _currencyToken;
    }

    /**
     * @inheritdoc IVault
     */
    function lpToken(TrancheId trancheId) external view returns (IERC20) {
        return IERC20(address(_lpToken(trancheId)));
    }

    /**
     * @inheritdoc IVault
     */
    function loanPriceOracle() external view returns (ILoanPriceOracle) {
        return _loanPriceOracle;
    }

    /**
     * @inheritdoc IVault
     */
    function collateralLiquidator() external view returns (address) {
        return _collateralLiquidator;
    }

    /**
     * @inheritdoc IVault
     */
    function noteAdapters(address noteToken) external view returns (INoteAdapter) {
        return _noteAdapters[noteToken];
    }

    /**
     * @inheritdoc IVault
     */
    function sharePrice(TrancheId trancheId) external view returns (uint256) {
        return _computeSharePrice(trancheId);
    }

    /**
     * @inheritdoc IVault
     */
    function redemptionSharePrice(TrancheId trancheId) external view returns (uint256) {
        return _computeRedemptionSharePrice(trancheId);
    }

    /**
     * @inheritdoc IVault
     */
    function utilization() external view returns (uint256) {
        return _computeUtilization();
    }

    /**************************************************************************/
    /* Additional Getters */
    /**************************************************************************/

    /**
     * @notice Get tranche state
     * @param trancheId Tranche
     * @return depositValue Deposit value
     * @return pendingRedemptions Pending redemptions
     * @return redemptionQueue Current redemption queue
     * @return processedRedemptionQueue Processed redemption queue
     */
    function trancheState(TrancheId trancheId)
        external
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

    /**
     * @notice Get vault balance state
     * @return totalCashBalance Total cash balance
     * @return totalLoanBalance Total loan balance
     * @return totalWithdrawalBalance Total withdrawal balance
     */
    function balanceState()
        external
        view
        returns (
            uint256 totalCashBalance,
            uint256 totalLoanBalance,
            uint256 totalWithdrawalBalance
        )
    {
        return (_totalCashBalance, _totalLoanBalance, _totalWithdrawalBalance);
    }

    /**
     * @notice Get Loan state
     * @param noteToken Note token contract
     * @param noteTokenId Note token ID
     * @return Loan state
     */
    function loanState(address noteToken, uint256 noteTokenId) external view returns (Loan memory) {
        return _loans[noteToken][noteTokenId];
    }

    /**
     * @notice Get senior tranche rate
     * @return Senior tranche rate in UD60x18 amount per second
     */
    function seniorTrancheRate() external view returns (uint256) {
        return _seniorTrancheRate;
    }

    /**
     * @notice Get cash reserve ratio
     * @return Cash reserve ratio in UD60x18 amount per second
     */
    function reserveRatio() external view returns (uint256) {
        return _reserveRatio;
    }

    /**
     * @notice Get cash reserves available
     * @return Cash reserves available in currency tokens
     */
    function reservesAvailable() external view returns (uint256) {
        return _computeCashReservesAvailable();
    }

    /**************************************************************************/
    /* Internal Helper Functions */
    /**************************************************************************/

    /**
     * @dev Get LP token contract
     */
    function _lpToken(TrancheId trancheId) internal view returns (LPToken) {
        return (trancheId == TrancheId.Senior) ? _seniorLPToken : _juniorLPToken;
    }

    /**
     * @dev Get tranche state
     */
    function _trancheState(TrancheId trancheId) internal view returns (Tranche storage) {
        return (trancheId == TrancheId.Senior) ? _tranches.senior : _tranches.junior;
    }

    /**
     * @dev Convert Unix timestamp to time bucket
     */
    function _timestampToTimeBucket(uint64 timestamp) internal pure returns (uint64) {
        return timestamp / TIME_BUCKET_DURATION;
    }

    /**
     * @dev Convert time bucket to Unix timestamp
     */
    function _timeBucketToTimestamp(uint64 timeBucket) internal pure returns (uint64) {
        return timeBucket * TIME_BUCKET_DURATION;
    }

    /**
     * @dev Compute estimated value of the tranche, including prorated pending
     * returns
     * @param trancheId tranche
     * @return Estimated value in currency tokens
     */
    function _computeEstimatedValue(TrancheId trancheId) internal view returns (uint256) {
        Tranche storage tranche = _trancheState(trancheId);

        /* Get the current time bucket */
        uint64 currentTimeBucket = _timestampToTimeBucket(uint64(block.timestamp));

        /* Compute elapsed time into current time bucket and convert to UD60x18 */
        uint256 elapsedTimeIntoBucket = PRBMathUD60x18.fromUint(
            block.timestamp - _timeBucketToTimestamp(currentTimeBucket)
        );

        /* Sum the prorated returns from pending returns in each time bucket */
        uint256 proratedReturns;
        for (uint64 i = 0; i < SHARE_PRICE_PRORATION_BUCKETS; i++) {
            /* Prorated Returns[i] = ((Elapsed Time + W * (N - 1 - i)) / (W * N)) * Pending Returns[i]  */
            proratedReturns += PRBMathUD60x18.div(
                PRBMathUD60x18.mul(
                    elapsedTimeIntoBucket +
                        PRBMathUD60x18.fromUint(TIME_BUCKET_DURATION * (SHARE_PRICE_PRORATION_BUCKETS - 1 - i)),
                    tranche.pendingReturns[currentTimeBucket + i]
                ),
                PRBMathUD60x18.fromUint(TOTAL_SHARE_PRICE_PRORATION_DURATION)
            );
        }

        /* Return the deposit value plus prorated returns */
        return tranche.depositValue + proratedReturns;
    }

    /**
     * @dev Compute share price of tranche including prorated pending returns
     * @param trancheId tranche
     * @return Share price in UD60x18
     */
    function _computeSharePrice(TrancheId trancheId) internal view returns (uint256) {
        uint256 estimatedValue = _computeEstimatedValue(trancheId);
        uint256 totalSupply = _lpToken(trancheId).totalSupply();
        return (totalSupply == 0) ? 1e18 : PRBMathUD60x18.div(estimatedValue, totalSupply);
    }

    /**
     * @dev Compute redemption share price of tranche
     * @param trancheId tranche
     * @return Redemption share price in UD60x18
     */
    function _computeRedemptionSharePrice(TrancheId trancheId) internal view returns (uint256) {
        uint256 depositValue = _trancheState(trancheId).depositValue;
        uint256 totalSupply = _lpToken(trancheId).totalSupply();
        return (totalSupply == 0) ? 1e18 : PRBMathUD60x18.div(depositValue, totalSupply);
    }

    /**
     * @dev Compute cash reserves available
     * @return Cash reserves in currency tokens
     */
    function _computeCashReservesAvailable() internal view returns (uint256) {
        return Math.min(_totalCashBalance, PRBMathUD60x18.mul(_reserveRatio, _totalCashBalance + _totalLoanBalance));
    }

    /**
     * @dev Compute utilization
     * @return Utilization in UD60x18, between 0 and 1
     */
    function _computeUtilization() internal view returns (uint256) {
        uint256 totalBalance = _totalCashBalance + _totalLoanBalance;
        return (totalBalance == 0) ? 0 : PRBMathUD60x18.div(_totalLoanBalance, totalBalance);
    }

    /**
     * @dev Process redemptions for tranche
     * @param tranche Tranche
     * @param proceeds Proceeds in currency tokens
     */
    function _processRedemptions(Tranche storage tranche, uint256 proceeds) internal returns (uint256) {
        /* Compute maximum redemption possible */
        uint256 redemptionAmount = Math.min(tranche.pendingRedemptions, proceeds);

        /* Update tranche redemption state */
        tranche.pendingRedemptions -= redemptionAmount;
        tranche.processedRedemptionQueue += redemptionAmount;
        tranche.depositValue -= redemptionAmount;

        /* Move redemption from cash to withdrawal balance */
        _totalCashBalance -= redemptionAmount;
        _totalWithdrawalBalance += redemptionAmount;

        /* Return amount of cash leftover (for further tranche redemptions) */
        return proceeds - redemptionAmount;
    }

    /**
     * @dev Update tranche state with currency deposit and mint LP tokens to
     * depositer
     * @param trancheId tranche
     * @param amount Amount of currency tokens
     */
    function _deposit(TrancheId trancheId, uint256 amount) internal {
        /* Compute current share price */
        uint256 currentSharePrice = _computeSharePrice(trancheId);

        /* Check tranche is solvent */
        require(currentSharePrice != 0, "Tranche is currently insolvent");

        /* Compute number of shares to mint from current tranche share price */
        uint256 shares = PRBMathUD60x18.div(amount, currentSharePrice);

        /* Increase deposit value of tranche */
        _trancheState(trancheId).depositValue += amount;

        /* Increase total cash balance */
        _totalCashBalance += amount;

        /* Mint LP tokens to user */
        _lpToken(trancheId).mint(msg.sender, shares);

        emit Deposited(msg.sender, trancheId, amount, shares);
    }

    /**
     * @dev Calculate purchase price of note and update tranche state with note
     * purchase
     * @param noteToken Note token contract
     * @param noteTokenId Note token ID
     * @param minPurchasePrice Minimum purchase price in currency tokens
     */
    function _sellNote(
        address noteToken,
        uint256 noteTokenId,
        uint256 minPurchasePrice
    ) internal returns (uint256) {
        INoteAdapter noteAdapter = _noteAdapters[noteToken];

        /* Validate note token is supported */
        require(noteAdapter != INoteAdapter(address(0x0)), "Unsupported note token");

        /* Check if loan parameters are supported */
        require(noteAdapter.isSupported(noteTokenId, address(_currencyToken)), "Unsupported note parameters");

        /* Get loan info */
        INoteAdapter.LoanInfo memory loanInfo = noteAdapter.getLoanInfo(noteTokenId);

        /* Get loan purchase price */
        uint256 purchasePrice = _loanPriceOracle.priceLoan(
            loanInfo.collateralToken,
            loanInfo.collateralTokenId,
            loanInfo.principal,
            loanInfo.repayment,
            loanInfo.duration,
            loanInfo.maturity,
            _computeUtilization()
        );

        /* Validate purchase price */
        require(purchasePrice >= minPurchasePrice, "Purchase price less than min");

        /* Validate repayment */
        require(loanInfo.repayment > purchasePrice, "Purchase price exceeds repayment");

        /* Validate cash available */
        require(_totalCashBalance - _computeCashReservesAvailable() >= purchasePrice, "Insufficient cash in vault");

        /* Calculate senior tranche contribution based on deposit proportion */
        /* Senior Tranche Contribution = (D_s / (D_s + D_j)) * Purchase Price */
        uint256 seniorTrancheContribution = PRBMathUD60x18.div(
            PRBMathUD60x18.mul(_tranches.senior.depositValue, purchasePrice),
            _tranches.senior.depositValue + _tranches.junior.depositValue
        );

        /* Calculate senior tranche return */
        /* Senior Tranche Return = Senior Tranche Contribution * (1 + r * t) */
        uint256 seniorTrancheReturn = PRBMathUD60x18.mul(
            seniorTrancheContribution,
            1e18 + PRBMathUD60x18.mul(_seniorTrancheRate, PRBMathUD60x18.fromUint(loanInfo.maturity - block.timestamp))
        ) - seniorTrancheContribution;

        /* Validate senior tranche return */
        require(seniorTrancheReturn < (loanInfo.repayment - purchasePrice), "Interest rate too low");

        /* Calculate junior tranche return */
        /* Junior Tranche Return = Repayment - Purchase Price - Senior Tranche Return */
        uint256 juniorTrancheReturn = loanInfo.repayment - purchasePrice - seniorTrancheReturn;

        /* Compute loan maturity time bucket */
        uint64 loanMaturityTimeBucket = _timestampToTimeBucket(loanInfo.maturity);

        /* Schedule pending tranche returns */
        _tranches.senior.pendingReturns[loanMaturityTimeBucket] += seniorTrancheReturn;
        _tranches.junior.pendingReturns[loanMaturityTimeBucket] += juniorTrancheReturn;

        /* Update global cash and loan balances */
        _totalCashBalance -= purchasePrice;
        _totalLoanBalance += purchasePrice;

        /* Store loan state */
        Loan storage loan = _loans[noteToken][noteTokenId];
        loan.active = true;
        loan.collateralToken = IERC721(loanInfo.collateralToken);
        loan.collateralTokenId = loanInfo.collateralTokenId;
        loan.purchasePrice = purchasePrice;
        loan.repayment = loanInfo.repayment;
        loan.maturity = loanInfo.maturity;
        loan.liquidated = false;
        loan.trancheReturns = [seniorTrancheReturn, juniorTrancheReturn];

        emit NotePurchased(msg.sender, noteToken, noteTokenId, purchasePrice);

        return purchasePrice;
    }

    /**************************************************************************/
    /* User API */
    /**************************************************************************/

    /**
     * @inheritdoc IVault
     */
    function deposit(TrancheId trancheId, uint256 amount) external whenNotPaused {
        /* Deposit into tranche */
        _deposit(trancheId, amount);

        /* Transfer cash from user to vault */
        IERC20Upgradeable(address(_currencyToken)).safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @inheritdoc IVault
     */
    function sellNote(
        IERC721 noteToken,
        uint256 noteTokenId,
        uint256 minPurchasePrice
    ) external whenNotPaused {
        /* Purchase the note */
        uint256 purchasePrice = _sellNote(address(noteToken), noteTokenId, minPurchasePrice);

        /* Transfer promissory note from user to vault */
        noteToken.safeTransferFrom(msg.sender, address(this), noteTokenId);

        /* Transfer cash from vault to user */
        IERC20Upgradeable(address(_currencyToken)).safeTransfer(msg.sender, purchasePrice);
    }

    /**
     * @inheritdoc IVault
     */
    function sellNoteAndDeposit(
        IERC721 noteToken,
        uint256 noteTokenId,
        uint256[2] calldata amounts
    ) external whenNotPaused {
        /* Calculate total min purchase price */
        uint256 minPurchasePrice = amounts[0] + amounts[1];

        /* Purchase the note */
        uint256 purchasePrice = _sellNote(address(noteToken), noteTokenId, minPurchasePrice);

        /* Deposit sale proceeds in tranches */
        if (amounts[0] != 0 && amounts[1] != 0) {
            /* Both senior and junior (excess goes to junior) */
            _deposit(TrancheId.Senior, amounts[0]);
            _deposit(TrancheId.Junior, purchasePrice - amounts[0]);
        } else if (amounts[0] != 0) {
            /* Only senior */
            _deposit(TrancheId.Senior, purchasePrice);
        } else {
            /* Only junior */
            _deposit(TrancheId.Junior, purchasePrice);
        }

        /* Transfer promissory note from user to vault */
        noteToken.safeTransferFrom(msg.sender, address(this), noteTokenId);
    }

    /**
     * @inheritdoc IVault
     */
    function redeem(TrancheId trancheId, uint256 shares) external whenNotPaused {
        Tranche storage tranche = _trancheState(trancheId);

        /* Compute current redemption share price */
        uint256 currentRedemptionSharePrice = _computeRedemptionSharePrice(trancheId);

        /* Check tranche is solvent */
        require(currentRedemptionSharePrice != 0, "Tranche is currently insolvent");

        /* Compute redemption amount */
        uint256 redemptionAmount = PRBMathUD60x18.mul(shares, currentRedemptionSharePrice);

        /* Schedule redemption in tranche */
        tranche.pendingRedemptions += redemptionAmount;
        tranche.redemptionQueue += redemptionAmount;

        /* Schedule redemption with user's token state and burn LP tokens */
        _lpToken(trancheId).redeem(msg.sender, shares, redemptionAmount, tranche.redemptionQueue);

        /* Process redemption from cash reserves */
        _processRedemptions(tranche, _computeCashReservesAvailable());

        emit Redeemed(msg.sender, trancheId, shares, redemptionAmount);
    }

    /**
     * @inheritdoc IVault
     */
    function withdraw(TrancheId trancheId, uint256 amount) external whenNotPaused {
        Tranche storage tranche = _trancheState(trancheId);

        /* Update user's token state with redemption */
        _lpToken(trancheId).withdraw(msg.sender, amount, tranche.processedRedemptionQueue);

        /* Decrease global withdrawal balance */
        _totalWithdrawalBalance -= amount;

        /* Transfer cash from vault to user */
        IERC20Upgradeable(address(_currencyToken)).safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, trancheId, amount);
    }

    /**************************************************************************/
    /* Liquidation API */
    /**************************************************************************/

    /**
     * @inheritdoc IVault
     */
    function liquidateLoan(address noteToken, uint256 noteTokenId) external nonReentrant {
        INoteAdapter noteAdapter = _noteAdapters[noteToken];

        /* Validate note token is supported */
        require(noteAdapter != INoteAdapter(address(0x0)), "Unsupported note token");

        /* Call liquidate on lending platform */
        (bool success, ) = noteAdapter.lendingPlatform().call(noteAdapter.getLiquidateCalldata(noteTokenId));
        require(success, "Liquidate failed");

        /* Process loan liquidation */
        onLoanLiquidated(noteToken, noteTokenId);
    }

    /**
     * @inheritdoc IVault
     */
    function withdrawCollateral(address noteToken, uint256 noteTokenId) external {
        /* Validate caller is collateral liquidation contract */
        require(msg.sender == _collateralLiquidator, "Invalid caller");

        /* Lookup loan metadata */
        Loan storage loan = _loans[noteToken][noteTokenId];

        /* Validate loan exists with contract */
        require(loan.active, "Unknown loan");

        /* Validate loan was liquidated */
        require(loan.liquidated, "Loan not liquidated");

        /* Transfer collateral to liquidator */
        loan.collateralToken.safeTransferFrom(address(this), _collateralLiquidator, loan.collateralTokenId);

        emit CollateralWithdrawn(
            noteToken,
            noteTokenId,
            address(loan.collateralToken),
            loan.collateralTokenId,
            _collateralLiquidator
        );
    }

    /**************************************************************************/
    /* Callbacks */
    /**************************************************************************/

    /**
     * @inheritdoc ILoanReceiver
     */
    function onLoanRepaid(address noteToken, uint256 noteTokenId) external {
        INoteAdapter noteAdapter = _noteAdapters[noteToken];

        /* Validate note token is supported */
        require(noteAdapter != INoteAdapter(address(0x0)), "Unsupported note token");

        /* Lookup loan state */
        Loan storage loan = _loans[noteToken][noteTokenId];

        /* Validate loan exists with contract */
        require(loan.active, "Unknown loan");

        /* Validate loan was repaid, either because caller is the lending
         * platform (trusted), or by checking the loan is complete and the
         * collateral is not in contract's possession (trustless) */
        bool loanRepaid = (msg.sender == noteAdapter.lendingPlatform()) ||
            (noteAdapter.isComplete(noteTokenId) &&
                loan.collateralToken.ownerOf(loan.collateralTokenId) != address(this));
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
        _totalLoanBalance -= loan.purchasePrice;
        _totalCashBalance += loan.repayment;

        /* Process redemptions for both tranches */
        uint256 proceeds = loan.repayment;
        proceeds = _processRedemptions(_tranches.senior, proceeds);
        _processRedemptions(_tranches.junior, proceeds);

        /* Disable loan */
        loan.active = false;

        emit LoanRepaid(
            noteToken,
            noteTokenId,
            [loan.trancheReturns[uint256(TrancheId.Senior)], loan.trancheReturns[uint256(TrancheId.Junior)]]
        );
    }

    /**
     * @inheritdoc ILoanReceiver
     */
    function onLoanLiquidated(address noteToken, uint256 noteTokenId) public {
        INoteAdapter noteAdapter = _noteAdapters[noteToken];

        /* Validate note token is supported */
        require(noteAdapter != INoteAdapter(address(0x0)), "Unsupported note token");

        /* Lookup loan metadata */
        Loan storage loan = _loans[noteToken][noteTokenId];

        /* Validate loan exists with contract */
        require(loan.active, "Unknown loan");

        /* Validate loan liquidation wasn't already processed */
        require(!loan.liquidated, "Loan liquidation processed");

        /* Validate loan was liquidated, either because caller is the lending
         * platform (trusted), or by checking the loan is complete and the
         * collateral is in the contract's possession (trustless) */
        bool loanLiquidated = (msg.sender == noteAdapter.lendingPlatform()) ||
            (noteAdapter.isComplete(noteTokenId) &&
                loan.collateralToken.ownerOf(loan.collateralTokenId) == address(this));
        require(loanLiquidated, "Loan not liquidated");

        /* Compute loan maturity time bucket */
        uint64 loanMaturityTimeBucket = _timestampToTimeBucket(loan.maturity);

        /* Unschedule pending returns */
        _tranches.senior.pendingReturns[loanMaturityTimeBucket] -= loan.trancheReturns[uint256(TrancheId.Senior)];
        _tranches.junior.pendingReturns[loanMaturityTimeBucket] -= loan.trancheReturns[uint256(TrancheId.Junior)];

        /* Compute tranche losses */
        uint256 juniorTrancheLoss = Math.min(loan.purchasePrice, _tranches.junior.depositValue);
        uint256 seniorTrancheLoss = loan.purchasePrice - juniorTrancheLoss;

        /* Decrease tranche deposit values */
        _tranches.senior.depositValue -= seniorTrancheLoss;
        _tranches.junior.depositValue -= juniorTrancheLoss;

        /* Decrease total loan balance */
        _totalLoanBalance -= loan.purchasePrice;

        /* Update tranche returns for collateral liquidation */
        loan.trancheReturns[uint256(TrancheId.Senior)] += seniorTrancheLoss;
        loan.trancheReturns[uint256(TrancheId.Junior)] = 0;

        /* Mark loan liquidated in loan state */
        loan.liquidated = true;

        emit LoanLiquidated(noteToken, noteTokenId, [seniorTrancheLoss, juniorTrancheLoss]);
    }

    /**
     * @inheritdoc IVault
     */
    function onCollateralLiquidated(
        address noteToken,
        uint256 noteTokenId,
        uint256 proceeds
    ) external {
        /* Validate caller is collateral liquidation contract */
        require(msg.sender == _collateralLiquidator, "Invalid caller");

        /* Lookup loan metadata */
        Loan storage loan = _loans[noteToken][noteTokenId];

        /* Validate loan exists with contract */
        require(loan.active, "Unknown loan");

        /* Validate loan was liquidated */
        require(loan.liquidated, "Loan not liquidated");

        /* Compute tranche repayments */
        uint256 seniorTrancheRepayment = Math.min(proceeds, loan.trancheReturns[uint256(TrancheId.Senior)]);
        uint256 juniorTrancheRepayment = proceeds - seniorTrancheRepayment;

        /* Increase tranche deposit values */
        _tranches.senior.depositValue += seniorTrancheRepayment;
        _tranches.junior.depositValue += juniorTrancheRepayment;

        /* Increase total cash balance */
        _totalCashBalance += proceeds;

        /* Process redemptions for both tranches */
        proceeds = _processRedemptions(_tranches.senior, proceeds);
        _processRedemptions(_tranches.junior, proceeds);

        /* Disable loan */
        loan.active = false;

        emit CollateralLiquidated(noteToken, noteTokenId, proceeds);
    }

    /**************************************************************************/
    /* Multicall */
    /**************************************************************************/

    /**
     * @notice Execute a batch of function calls on this contract.
     * Inlined from openzeppelin/contracts/utils/Multicall.sol.
     * @param data Calldatas
     * @return results Call results
     */
    function multicall(bytes[] calldata data) external returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            /// @custom:oz-upgrades-unsafe-allow delegatecall
            (bool success, bytes memory returndata) = address(this).delegatecall(data[i]);
            if (success) {
                results[i] = returndata;
            } else {
                if (returndata.length > 0) {
                    assembly {
                        let returndata_size := mload(returndata)
                        revert(add(32, returndata), returndata_size)
                    }
                } else {
                    revert("Low-level delegate call failed");
                }
            }
        }
        return results;
    }

    /**************************************************************************/
    /* Setters */
    /**************************************************************************/

    /**
     * @notice Set the senior tranche rate
     *
     * Emits a {SeniorTrancheRateUpdated} event.
     *
     * @param rate Rate in UD60x18 amount per second
     */
    function setSeniorTrancheRate(uint256 rate) external onlyOwner {
        _seniorTrancheRate = rate;
        emit SeniorTrancheRateUpdated(rate);
    }

    /**
     * @notice Set the cash reserve ratio
     *
     * Emits a {SeniorTrancheRateUpdated} event.
     *
     * @param ratio Reserve ratio in UD60x18
     */
    function setReserveRatio(uint256 ratio) external onlyOwner {
        _reserveRatio = ratio;
        emit ReserveRatioUpdated(ratio);
    }

    /**
     * @notice Set the loan price oracle contract
     *
     * Emits a {LoanPriceOracleUpdated} event.
     *
     * @param loanPriceOracle_ Loan price oracle contract
     */
    function setLoanPriceOracle(address loanPriceOracle_) external onlyOwner {
        _loanPriceOracle = ILoanPriceOracle(loanPriceOracle_);
        emit LoanPriceOracleUpdated(loanPriceOracle_);
    }

    /**
     * @notice Set the collateral liquidator contract
     *
     * Emits a {CollateralLiquidatorUpdated} event.
     *
     * @param collateralLiquidator_ Collateral liquidator contract
     */
    function setCollateralLiquidator(address collateralLiquidator_) external onlyOwner {
        _collateralLiquidator = collateralLiquidator_;
        emit CollateralLiquidatorUpdated(collateralLiquidator_);
    }

    /**
     * @notice Set note adapter contract
     *
     * Emits a {NoteAdapterUpdated} event.
     *
     * @param noteToken Note token contract
     * @param noteAdapter Note adapter contract
     */
    function setNoteAdapter(address noteToken, address noteAdapter) external onlyOwner {
        _noteAdapters[noteToken] = INoteAdapter(noteAdapter);
        emit NoteAdapterUpdated(noteToken, noteAdapter);
    }

    /**
     * @notice Set paused state of contract.
     * @param paused Paused
     */
    function setPaused(bool paused) external onlyOwner {
        if (paused) {
            _pause();
        } else {
            _unpause();
        }
    }

    /******************************************************/
    /* ERC165 interface */
    /******************************************************/

    /**
     * @inheritdoc IERC165
     */
    function supportsInterface(bytes4 interfaceId) external view override returns (bool) {
        return _supportedInterfaces[interfaceId];
    }

    /******************************************************/
    /* Receiver Hooks */
    /******************************************************/

    /**
     * @inheritdoc IERC721Receiver
     */
    function onERC721Received(
        address, /* operator */
        address, /* from */
        uint256, /* tokenId */
        bytes calldata /* data */
    ) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
