# Security Notes

## `solhint` Warning Review

### `contracts/Vault.sol`

```
   912:28  warning  Avoid to use low level calls                                       avoid-low-level-calls

    function withdrawCollateral(address noteToken, uint256 loanId) external onlyRole(COLLATERAL_LIQUIDATOR_ROLE) {
        ...
        (address target, bytes memory data) = noteAdapter.getUnwrapCalldata(loanId);
        ...
            (bool success, ) = target.call(data);
        ...
    }
```
This low-level `call()` is used to unwrap collateral after a loan liquidation,
required by some lending platforms. In order to have generic support for
multiple lending platforms, the unwrap target and calldata must be constructed
by the note adapter, and subsequently requires a low-level call to execute it
from the Vault.

```
  1022:28  warning  Avoid to use low level calls                                       avoid-low-level-calls

    function onLoanExpired(address noteToken, uint256 loanId) public nonReentrant {
        ...
        (address target, bytes memory data) = noteAdapter.getLiquidateCalldata(loanId);
        ...
        (bool success, ) = target.call(data);
        ...
    }
```
This low-level `call()` is used to liquidate a loan on the lending platform by
the Vault. In order to have generic support for multiple lending platforms, the
liquidation target and calldata must be constructed by the note adapter, and
subsequently requires a low-level call to execute it from the Vault.

## `slither` Warning Review

```
Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#708-789) performs a multiplication on the result of a division:
```
This is a required operation for the senior tranche return calculation.

--------------------------------------------------------------------------------

```
Reentrancy in Vault._deposit(IVault.TrancheId,uint256) (contracts/Vault.sol#679-699):
Reentrancy in Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#708-789):
Reentrancy in Vault.sellNoteAndDeposit(address,uint256,uint256,uint256[2]) (contracts/Vault.sol#827-849):
Reentrancy in Vault.redeem(IVault.TrancheId,uint256) (contracts/Vault.sol#854-879):
Reentrancy in Vault.withdraw(IVault.TrancheId,uint256) (contracts/Vault.sol#884-903):
```
These reentrancy warnings concern LoanPriceOracle and LPToken, which are
trusted contracts, deployed with the Vault.

--------------------------------------------------------------------------------

```
Reentrancy in Vault.onLoanExpired(address,uint256) (contracts/Vault.sol#1022-1035):
```
This method is protected by a reentrancy guard.

--------------------------------------------------------------------------------

```
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1078-1124) has external calls inside a loop: noteAdapter.isRepaid(loanId) (contracts/Vault.sol#1109)
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1078-1124) has external calls inside a loop: noteAdapter.isLiquidated(loanId) (contracts/Vault.sol#1112)
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1078-1124) has external calls inside a loop: noteAdapter.isExpired(loanId) (contracts/Vault.sol#1115)
```
This method is intended only to be used off-chain.

--------------------------------------------------------------------------------

```
LoanPriceOracle._computeRateComponent(LoanPriceOracle.PiecewiseLinearModel,uint256,uint256) (contracts/LoanPriceOracle.sol#139-153) uses timestamp for comparisons
LoanPriceOracle.priceLoan(address,uint256,uint256,uint256,uint256,uint256,uint256) (contracts/LoanPriceOracle.sol#182-231) uses timestamp for comparisons
Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#708-789) uses timestamp for comparisons
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1078-1124) uses timestamp for comparisons
```
Timestamps are necessary for computing the loan maturity time bucket, loan
duration remaining, and the loan purchase price, and those results are
subsequently used in some comparisons.
