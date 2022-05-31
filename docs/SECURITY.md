# Security Notes

## `solhint` Warning Review

### `contracts/Vault.sol`

```
   958:32  warning  Avoid to use low level calls                                       avoid-low-level-calls

    function withdrawCollateral(address noteToken, uint256 loanId)
        external
        nonReentrant
        onlyRole(COLLATERAL_LIQUIDATOR_ROLE)
    {
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
  1060:28  warning  Avoid to use low level calls                                       avoid-low-level-calls

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
Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#720-808) performs a multiplication on the result of a division:
```
This is a required operation for the senior tranche return calculation.

--------------------------------------------------------------------------------

```
Reentrancy in Vault.sellNoteAndDeposit(address,uint256,uint256,uint256[2]) (contracts/Vault.sol#849-871):
Reentrancy in Vault.redeem(IVault.TrancheId,uint256) (contracts/Vault.sol#876-904):
Reentrancy in Vault.withdraw(IVault.TrancheId,uint256) (contracts/Vault.sol#909-930):
Reentrancy in Vault.onCollateralLiquidated(address,uint256,uint256) (contracts/Vault.sol#1069-1098):
Reentrancy in Vault.onLoanExpired(address,uint256) (contracts/Vault.sol#1020-1064):
Reentrancy in Vault.withdrawAdminFees(address,uint256) (contracts/Vault.sol#1256-1267):
Reentrancy in Vault.withdrawCollateral(address,uint256) (contracts/Vault.sol#939-966):
```
These methods are protected by a reentrancy guard.

--------------------------------------------------------------------------------

```
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1107-1150) has external calls inside a loop: noteAdapter.isRepaid(loanId) (contracts/Vault.sol#1138)
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1107-1150) has external calls inside a loop: noteAdapter.isExpired(loanId) (contracts/Vault.sol#1141)
```
This method is intended only to be used off-chain.

--------------------------------------------------------------------------------

```
LoanPriceOracle._computeRateComponent(LoanPriceOracle.PiecewiseLinearModel,uint256,uint256) (contracts/LoanPriceOracle.sol#171-185) uses timestamp for comparisons
LoanPriceOracle.priceLoan(address,uint256,uint256,uint256,uint256,uint256,uint256) (contracts/LoanPriceOracle.sol#214-264) uses timestamp for comparisons
Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#720-808) uses timestamp for comparisons
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1107-1150) uses timestamp for comparisons
```
Timestamps are necessary for computing the loan maturity time bucket, loan
duration remaining, and the loan purchase price, and those results are
subsequently used in some comparisons.
