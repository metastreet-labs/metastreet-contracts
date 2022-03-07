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

abstract contract VaultStorageV1 {
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
        bool active;
        IERC721 collateralToken;
        uint256 collateralTokenId;
        uint256 purchasePrice;
        uint256 repayment;
        uint64 maturity;
        bool liquidated;
        uint256[2] trancheReturns;
    }

    /* Properties and Linked Contracts */
    string internal _name;
    IERC20 internal _currencyToken;
    ILoanPriceOracle internal _loanPriceOracle;
    address internal _collateralLiquidator;
    mapping(address => INoteAdapter) internal _noteAdapters;
    LPToken internal _seniorLPToken;
    LPToken internal _juniorLPToken;
    mapping(bytes4 => bool) internal _supportedInterfaces;

    /* Parameters */
    uint256 internal _seniorTrancheRate; /* UD60x18, in amount per seconds */
    uint256 internal _reserveRatio; /* UD60x18 */

    /* State */
    Tranches internal _tranches;
    uint256 internal _totalLoanBalance;
    uint256 internal _totalCashBalance;
    uint256 internal _totalWithdrawalBalance;
    mapping(address => mapping(uint256 => Loan)) internal _loans;
}

abstract contract VaultStorage is VaultStorageV1 {}

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

    string public constant IMPLEMENTATION_VERSION = "1.0";
    uint64 public constant TIME_BUCKET_DURATION = 14 days;
    uint64 public constant SHARE_PRICE_PRORATION_BUCKETS = 6;
    uint64 public constant TOTAL_SHARE_PRICE_PRORATION_DURATION = TIME_BUCKET_DURATION * SHARE_PRICE_PRORATION_BUCKETS;

    /**************************************************************************/
    /* Events */
    /**************************************************************************/

    event SeniorTrancheRateUpdated(uint256 rate);
    event ReserveRatioUpdated(uint256 ratio);
    event LoanPriceOracleUpdated(address loanPriceOracle);
    event CollateralLiquidatorUpdated(address collateralLiquidator);
    event NoteAdapterUpdated(address noteToken, address noteAdapter);

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    function initialize(
        string memory name_,
        IERC20 currencyToken_,
        ILoanPriceOracle loanPriceOracle_,
        LPToken seniorLPToken_,
        LPToken juniorLPToken_
    ) public initializer {
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

    function name() public view returns (string memory) {
        return _name;
    }

    function currencyToken() public view returns (IERC20) {
        return _currencyToken;
    }

    function lpToken(TrancheId trancheId) public view returns (IERC20) {
        return IERC20(address(_lpToken(trancheId)));
    }

    function loanPriceOracle() public view returns (ILoanPriceOracle) {
        return _loanPriceOracle;
    }

    function collateralLiquidator() public view returns (address) {
        return _collateralLiquidator;
    }

    function noteAdapters(address noteToken) public view returns (INoteAdapter) {
        return _noteAdapters[noteToken];
    }

    function sharePrice(TrancheId trancheId) public view returns (uint256) {
        return _computeSharePrice(trancheId);
    }

    function redemptionSharePrice(TrancheId trancheId) public view returns (uint256) {
        return _computeRedemptionSharePrice(trancheId);
    }

    function utilization() public view returns (uint256) {
        return _computeUtilization();
    }

    /**************************************************************************/
    /* Additional Getters */
    /**************************************************************************/

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

    function balanceState()
        public
        view
        returns (
            uint256 totalCashBalance,
            uint256 totalLoanBalance,
            uint256 totalWithdrawalBalance
        )
    {
        return (_totalCashBalance, _totalLoanBalance, _totalWithdrawalBalance);
    }

    function loanState(address noteToken, uint256 noteTokenId) public view returns (Loan memory) {
        return _loans[noteToken][noteTokenId];
    }

    function seniorTrancheRate() public view returns (uint256) {
        return _seniorTrancheRate;
    }

    function reserveRatio() public view returns (uint256) {
        return _reserveRatio;
    }

    function reservesAvailable() public view returns (uint256) {
        return _computeCashReservesAvailable();
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

    function _computeSharePrice(TrancheId trancheId) internal view returns (uint256) {
        uint256 estimatedValue = _computeEstimatedValue(trancheId);
        uint256 totalSupply = _lpToken(trancheId).totalSupply();
        return (totalSupply == 0) ? 1e18 : PRBMathUD60x18.div(estimatedValue, totalSupply);
    }

    function _computeRedemptionSharePrice(TrancheId trancheId) internal view returns (uint256) {
        uint256 depositValue = _trancheState(trancheId).depositValue;
        uint256 totalSupply = _lpToken(trancheId).totalSupply();
        return (totalSupply == 0) ? 1e18 : PRBMathUD60x18.div(depositValue, totalSupply);
    }

    function _computeCashReservesAvailable() internal view returns (uint256) {
        return Math.min(_totalCashBalance, PRBMathUD60x18.mul(_reserveRatio, _totalCashBalance + _totalLoanBalance));
    }

    function _computeUtilization() internal view returns (uint256) {
        uint256 totalBalance = _totalCashBalance + _totalLoanBalance;
        return (totalBalance == 0) ? 0 : PRBMathUD60x18.div(_totalLoanBalance, _totalCashBalance + _totalLoanBalance);
    }

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

    function _sellNote(
        IERC721 noteToken,
        uint256 noteTokenId,
        uint256 minPurchasePrice
    ) internal returns (uint256) {
        INoteAdapter noteAdapter = _noteAdapters[address(noteToken)];

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
        Loan storage loan = _loans[address(noteToken)][noteTokenId];
        loan.active = true;
        loan.collateralToken = IERC721(loanInfo.collateralToken);
        loan.collateralTokenId = loanInfo.collateralTokenId;
        loan.purchasePrice = purchasePrice;
        loan.repayment = loanInfo.repayment;
        loan.maturity = loanInfo.maturity;
        loan.liquidated = false;
        loan.trancheReturns = [seniorTrancheReturn, juniorTrancheReturn];

        emit NotePurchased(msg.sender, address(noteToken), noteTokenId, purchasePrice);

        return purchasePrice;
    }

    /**************************************************************************/
    /* User API */
    /**************************************************************************/

    function deposit(TrancheId trancheId, uint256 amount) public whenNotPaused {
        /* Deposit into tranche */
        _deposit(trancheId, amount);

        /* Transfer cash from user to vault */
        IERC20Upgradeable(address(_currencyToken)).safeTransferFrom(msg.sender, address(this), amount);
    }

    function sellNote(
        IERC721 noteToken,
        uint256 noteTokenId,
        uint256 minPurchasePrice
    ) public whenNotPaused {
        /* Purchase the note */
        uint256 purchasePrice = _sellNote(noteToken, noteTokenId, minPurchasePrice);

        /* Transfer promissory note from user to vault */
        noteToken.safeTransferFrom(msg.sender, address(this), noteTokenId);

        /* Transfer cash from vault to user */
        IERC20Upgradeable(address(_currencyToken)).safeTransfer(msg.sender, purchasePrice);
    }

    function sellNoteAndDeposit(
        IERC721 noteToken,
        uint256 noteTokenId,
        uint256[2] calldata amounts
    ) public whenNotPaused {
        /* Calculate total min purchase price */
        uint256 minPurchasePrice = amounts[0] + amounts[1];

        /* Purchase the note */
        uint256 purchasePrice = _sellNote(noteToken, noteTokenId, minPurchasePrice);

        /* Deposit sale proceeds in tranches */
        if (amounts[0] > 0) _deposit(TrancheId.Senior, amounts[0]);
        if (amounts[1] > 0) _deposit(TrancheId.Junior, purchasePrice - amounts[0]);

        /* Transfer promissory note from user to vault */
        noteToken.safeTransferFrom(msg.sender, address(this), noteTokenId);
    }

    function redeem(TrancheId trancheId, uint256 shares) public whenNotPaused {
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

    function withdraw(TrancheId trancheId, uint256 amount) public whenNotPaused {
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

    function liquidateLoan(IERC721 noteToken, uint256 noteTokenId) public nonReentrant {
        INoteAdapter noteAdapter = _noteAdapters[address(noteToken)];

        /* Validate note token is supported */
        require(noteAdapter != INoteAdapter(address(0x0)), "Unsupported note token");

        /* Call liquidate on lending platform */
        (bool success, ) = noteAdapter.lendingPlatform().call(noteAdapter.getLiquidateCalldata(noteTokenId));
        require(success, "Liquidate failed");

        /* Process loan liquidation */
        onLoanLiquidated(address(noteToken), noteTokenId);
    }

    function withdrawCollateral(IERC721 noteToken, uint256 noteTokenId) public {
        /* Validate caller is collateral liquidation contract */
        require(msg.sender == _collateralLiquidator, "Invalid caller");

        /* Lookup loan metadata */
        Loan storage loan = _loans[address(noteToken)][noteTokenId];

        /* Validate loan exists with contract */
        require(loan.active, "Unknown loan");

        /* Validate loan was liquidated */
        require(loan.liquidated, "Loan not liquidated");

        /* Transfer collateral to liquidator */
        loan.collateralToken.safeTransferFrom(address(this), _collateralLiquidator, loan.collateralTokenId);

        emit CollateralWithdrawn(
            address(noteToken),
            noteTokenId,
            address(loan.collateralToken),
            loan.collateralTokenId,
            _collateralLiquidator
        );
    }

    /**************************************************************************/
    /* Callbacks */
    /**************************************************************************/

    function onLoanRepaid(address noteToken, uint256 noteTokenId) public {
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

    function onLoanLiquidated(address noteToken, uint256 noteTokenId) public {
        INoteAdapter noteAdapter = _noteAdapters[noteToken];

        /* Validate note token is supported */
        require(noteAdapter != INoteAdapter(address(0x0)), "Unsupported note token");

        /* Lookup loan metadata */
        Loan storage loan = _loans[noteToken][noteTokenId];

        /* Validate loan exists with contract */
        require(loan.active, "Unknown loan");

        /* Validate loan was liquidated, either because caller is the lending
         * platform (trusted), or by checking the loan is complete and the
         * collateral is in the contract's possession (trustless) */
        bool loanLiquidated = (msg.sender == noteAdapter.lendingPlatform()) ||
            (noteAdapter.isComplete(noteTokenId) &&
                loan.collateralToken.ownerOf(loan.collateralTokenId) == address(this));
        require(loanLiquidated, "Loan not liquidated");

        /* Validate loan liquidation wasn't already processed */
        require(!loan.liquidated, "Loan liquidation processed");

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

    function onCollateralLiquidated(
        address noteToken,
        uint256 noteTokenId,
        uint256 proceeds
    ) public {
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

    /* Inlined from Address.sol */
    function multicall(bytes[] calldata data) public returns (bytes[] memory results) {
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

    function setSeniorTrancheRate(uint256 rate) public onlyOwner {
        _seniorTrancheRate = rate;
        emit SeniorTrancheRateUpdated(rate);
    }

    function setReserveRatio(uint256 ratio) public onlyOwner {
        _reserveRatio = ratio;
        emit ReserveRatioUpdated(ratio);
    }

    function setLoanPriceOracle(address loanPriceOracle_) public onlyOwner {
        _loanPriceOracle = ILoanPriceOracle(loanPriceOracle_);
        emit LoanPriceOracleUpdated(loanPriceOracle_);
    }

    function setCollateralLiquidator(address collateralLiquidator_) public onlyOwner {
        _collateralLiquidator = collateralLiquidator_;
        emit CollateralLiquidatorUpdated(collateralLiquidator_);
    }

    function setNoteAdapter(address noteToken, address noteAdapter) public onlyOwner {
        _noteAdapters[noteToken] = INoteAdapter(noteAdapter);
        emit NoteAdapterUpdated(noteToken, noteAdapter);
    }

    function setPaused(bool paused) public onlyOwner {
        if (paused) {
            _pause();
        } else {
            _unpause();
        }
    }

    /******************************************************/
    /* ERC165 interface */
    /******************************************************/

    function supportsInterface(bytes4 interfaceId) external view override returns (bool) {
        return _supportedInterfaces[interfaceId];
    }

    /******************************************************/
    /* Receiver Hooks */
    /******************************************************/

    function onERC721Received(
        address, /* operator */
        address, /* from */
        uint256, /* tokenId */
        bytes calldata /* data */
    ) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
