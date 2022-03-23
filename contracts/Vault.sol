// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
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
     * @dev Reserve ratio in UD60x18
     */
    uint256 internal _reserveRatio;

    /**************************************************************************/
    /* State */
    /**************************************************************************/

    Tranches internal _tranches;
    uint256 internal _totalLoanBalance;
    uint256 internal _totalCashBalance;
    uint256 internal _totalReservesBalance;
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
    ERC721Holder,
    IERC165,
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
    uint64 public constant TIME_BUCKET_DURATION = 15 days;

    /**
     * @notice Number of share price proration buckets
     */
    uint64 public constant SHARE_PRICE_PRORATION_BUCKETS = 6;

    /**
     * @notice Total share price proration window in seconds
     */
    uint64 public constant TOTAL_SHARE_PRICE_PRORATION_DURATION = TIME_BUCKET_DURATION * SHARE_PRICE_PRORATION_BUCKETS;

    /**
     * @notice One in UD60x18
     */
    uint64 public constant ONE_UD60X18 = 1e18;

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
        require(address(currencyToken_) != address(0), "Invalid currency token");
        require(address(loanPriceOracle_) != address(0), "Invalid loan price oracle");
        require(address(seniorLPToken_) != address(0), "Invalid senior LP token");
        require(address(juniorLPToken_) != address(0), "Invalid junior LP token");

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
        _supportedInterfaces[ERC721Holder.onERC721Received.selector] = true;
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
     * @return totalReservesBalance Total reserves balance (part of total cash balance)
     * @return totalLoanBalance Total loan balance
     * @return totalWithdrawalBalance Total withdrawal balance
     */
    function balanceState()
        external
        view
        returns (
            uint256 totalCashBalance,
            uint256 totalReservesBalance,
            uint256 totalLoanBalance,
            uint256 totalWithdrawalBalance
        )
    {
        return (_totalCashBalance, _totalReservesBalance, _totalLoanBalance, _totalWithdrawalBalance);
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
     * @return Cash reserve ratio as a percentage in UD60x18
     */
    function reserveRatio() external view returns (uint256) {
        return _reserveRatio;
    }

    /**************************************************************************/
    /* Modifiers */
    /**************************************************************************/

    /**
     * @dev Modifier for collateral liquidator
     */
    modifier onlyCollateralLiquidator() {
        require(msg.sender == _collateralLiquidator, "Invalid caller");
        _;
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
     * @dev Get and validate the note adapter for a note token
     */
    function _getNoteAdapter(address noteToken) internal view returns (INoteAdapter) {
        INoteAdapter noteAdapter = _noteAdapters[noteToken];

        /* Validate note token is supported */
        require(noteAdapter != INoteAdapter(address(0x0)), "Unsupported note token");

        return noteAdapter;
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
     * @dev Check if a tranche is solvent
     * @param trancheId tranche
     * @return Tranche is solvent
     */
    function _isSolvent(TrancheId trancheId) internal view returns (bool) {
        return _trancheState(trancheId).depositValue != 0 || _lpToken(trancheId).totalSupply() == 0;
    }

    /**
     * @dev Compute share price of tranche including prorated pending returns
     * @param trancheId tranche
     * @return Share price in UD60x18
     */
    function _computeSharePrice(TrancheId trancheId) internal view returns (uint256) {
        uint256 totalSupply = _lpToken(trancheId).totalSupply();
        if (totalSupply == 0) {
            return ONE_UD60X18;
        }
        return PRBMathUD60x18.div(_computeEstimatedValue(trancheId), totalSupply);
    }

    /**
     * @dev Compute redemption share price of tranche
     * @param trancheId tranche
     * @return Redemption share price in UD60x18
     */
    function _computeRedemptionSharePrice(TrancheId trancheId) internal view returns (uint256) {
        uint256 totalSupply = _lpToken(trancheId).totalSupply();
        if (totalSupply == 0) {
            return ONE_UD60X18;
        }
        return PRBMathUD60x18.div(_trancheState(trancheId).depositValue, totalSupply);
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
        uint256 redemptionAmount = Math.min(tranche.depositValue, Math.min(tranche.pendingRedemptions, proceeds));

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
     * @dev Update cash reserves balance
     * @param proceeds Proceeds in currency tokens
     */
    function _updateReservesBalance(uint256 proceeds) internal {
        /* Update cash reserves balance */
        uint256 targetReservesBalance = PRBMathUD60x18.mul(_reserveRatio, _totalCashBalance + _totalLoanBalance);
        uint256 delta = targetReservesBalance > _totalReservesBalance
            ? targetReservesBalance - _totalReservesBalance
            : 0;
        _totalReservesBalance += Math.min(delta, proceeds);
    }

    /**
     * @dev Apply new proceeds to processing redemptions and updating cash reserves
     * @param proceeds Proceeds in currency tokens
     */
    function _processRedemptionsAndUpdateReserves(uint256 proceeds) internal {
        /* Process senior redemptions */
        proceeds = _processRedemptions(_tranches.senior, proceeds);
        /* Process junior redemptions */
        proceeds = _processRedemptions(_tranches.junior, proceeds);
        /* Update cash reserves balance */
        _updateReservesBalance(proceeds);
    }

    /**
     * @dev Update tranche state with currency deposit and mint LP tokens to
     * depositer
     * @param trancheId tranche
     * @param amount Amount of currency tokens
     */
    function _deposit(TrancheId trancheId, uint256 amount) internal {
        /* Check tranche is solvent */
        require(_isSolvent(trancheId), "Tranche is currently insolvent");

        /* Compute current share price */
        uint256 currentSharePrice = _computeSharePrice(trancheId);

        /* Compute number of shares to mint from current tranche share price */
        uint256 shares = PRBMathUD60x18.div(amount, currentSharePrice);

        /* Increase deposit value of tranche */
        _trancheState(trancheId).depositValue += amount;

        /* Increase total cash balance */
        _totalCashBalance += amount;

        /* Process redemptions and update reserves with proceeds */
        _processRedemptionsAndUpdateReserves(amount);

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
        /* Lookup note adapter */
        INoteAdapter noteAdapter = _getNoteAdapter(noteToken);

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
        require(_totalCashBalance - _totalReservesBalance >= purchasePrice, "Insufficient cash in vault");

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
            ONE_UD60X18 +
                PRBMathUD60x18.mul(_seniorTrancheRate, PRBMathUD60x18.fromUint(loanInfo.maturity - block.timestamp))
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
        address noteToken,
        uint256 noteTokenId,
        uint256 minPurchasePrice
    ) external whenNotPaused {
        /* Purchase the note */
        uint256 purchasePrice = _sellNote(noteToken, noteTokenId, minPurchasePrice);

        /* Transfer promissory note from user to vault */
        IERC721(noteToken).safeTransferFrom(msg.sender, address(this), noteTokenId);

        /* Transfer cash from vault to user */
        IERC20Upgradeable(address(_currencyToken)).safeTransfer(msg.sender, purchasePrice);
    }

    /**
     * @inheritdoc IVault
     */
    function sellNoteAndDeposit(
        address noteToken,
        uint256 noteTokenId,
        uint256 minPurchasePrice,
        uint256[2] calldata allocation
    ) external whenNotPaused {
        /* Check allocations sum to one */
        require(allocation[0] + allocation[1] == ONE_UD60X18, "Invalid allocation");

        /* Purchase the note */
        uint256 purchasePrice = _sellNote(noteToken, noteTokenId, minPurchasePrice);

        /* Calculate split of sale proceeds */
        uint256 seniorTrancheAmount = PRBMathUD60x18.mul(allocation[0], purchasePrice);
        uint256 juniorTrancheAmount = purchasePrice - seniorTrancheAmount;

        /* Deposit sale proceeds in tranches */
        if (seniorTrancheAmount > 0) _deposit(TrancheId.Senior, seniorTrancheAmount);
        if (juniorTrancheAmount > 0) _deposit(TrancheId.Junior, juniorTrancheAmount);

        /* Transfer promissory note from user to vault */
        IERC721(noteToken).safeTransferFrom(msg.sender, address(this), noteTokenId);
    }

    /**
     * @inheritdoc IVault
     */
    function redeem(TrancheId trancheId, uint256 shares) external whenNotPaused {
        Tranche storage tranche = _trancheState(trancheId);

        /* Check tranche is solvent */
        require(_isSolvent(trancheId), "Tranche is currently insolvent");

        /* Compute current redemption share price */
        uint256 currentRedemptionSharePrice = _computeRedemptionSharePrice(trancheId);

        /* Compute redemption amount */
        uint256 redemptionAmount = PRBMathUD60x18.mul(shares, currentRedemptionSharePrice);

        /* Schedule redemption in tranche */
        tranche.pendingRedemptions += redemptionAmount;
        tranche.redemptionQueue += redemptionAmount;

        /* Schedule redemption with user's token state and burn LP tokens */
        _lpToken(trancheId).redeem(msg.sender, shares, redemptionAmount, tranche.redemptionQueue);

        /* Process redemption from cash reserves */
        uint256 immediateRedemptionAmount = Math.min(redemptionAmount, _totalReservesBalance);
        _totalReservesBalance -= immediateRedemptionAmount;
        _processRedemptions(tranche, immediateRedemptionAmount);

        emit Redeemed(msg.sender, trancheId, shares, redemptionAmount);
    }

    /**
     * @inheritdoc IVault
     */
    function withdraw(TrancheId trancheId, uint256 maxAmount) external whenNotPaused {
        Tranche storage tranche = _trancheState(trancheId);

        /* Calculate amount available to withdraw */
        uint256 amount = Math.min(
            _lpToken(trancheId).redemptionAvailable(msg.sender, tranche.processedRedemptionQueue),
            maxAmount
        );

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
        /* Lookup note adapter */
        INoteAdapter noteAdapter = _getNoteAdapter(noteToken);

        /* Call liquidate on lending platform */
        (bool success, ) = noteAdapter.lendingPlatform().call(noteAdapter.getLiquidateCalldata(noteTokenId));
        require(success, "Liquidate failed");

        /* Process loan liquidation */
        onLoanLiquidated(noteToken, noteTokenId);
    }

    /**
     * @inheritdoc IVault
     */
    function withdrawCollateral(address noteToken, uint256 noteTokenId) external onlyCollateralLiquidator {
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
        /* Lookup note adapter */
        INoteAdapter noteAdapter = _getNoteAdapter(noteToken);

        /* Lookup loan state */
        Loan storage loan = _loans[noteToken][noteTokenId];

        /* Validate loan exists with contract */
        require(loan.active, "Unknown loan");

        /* Validate loan wasn't liquidated */
        require(!loan.liquidated, "Loan liquidated");

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

        /* Process redemptions and update reserves with proceeds */
        _processRedemptionsAndUpdateReserves(loan.repayment);

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
        /* Lookup note adapter */
        INoteAdapter noteAdapter = _getNoteAdapter(noteToken);

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
    ) external onlyCollateralLiquidator {
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

        /* Process redemptions and update reserves with proceeds */
        _processRedemptionsAndUpdateReserves(proceeds);

        /* Disable loan */
        loan.active = false;

        /* Transfer cash from liquidator to vault */
        IERC20Upgradeable(address(_currencyToken)).safeTransferFrom(msg.sender, address(this), proceeds);

        emit CollateralLiquidated(noteToken, noteTokenId, [seniorTrancheRepayment, juniorTrancheRepayment]);
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
        require(rate > 0 && rate < ONE_UD60X18, "Parameter out of bounds");
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
        require(ratio < ONE_UD60X18, "Parameter out of bounds");
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
        require(loanPriceOracle_ != address(0), "Invalid address");
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
        require(collateralLiquidator_ != address(0), "Invalid address");
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
        require(noteToken != address(0), "Invalid address");
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
}
