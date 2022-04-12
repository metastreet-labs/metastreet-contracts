# Security Notes

## `solhint` Warning Review

### `contracts/Vault.sol`

```
   919:32  warning  Avoid to use low level calls                                       avoid-low-level-calls

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
  1015:28  warning  Avoid to use low level calls                                       avoid-low-level-calls

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
Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#690-777) performs a multiplication on the result of a division:
```
This is a required operation for the senior tranche return calculation.

--------------------------------------------------------------------------------

```
Reentrancy in Vault._deposit(IVault.TrancheId,uint256) (contracts/Vault.sol#661-681):
Reentrancy in Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#690-777):
Reentrancy in Vault.sellNoteAndDeposit(address,uint256,uint256,uint256[2]) (contracts/Vault.sol#815-837):
Reentrancy in Vault.redeem(IVault.TrancheId,uint256) (contracts/Vault.sol#842-867):
Reentrancy in Vault.withdraw(IVault.TrancheId,uint256) (contracts/Vault.sol#872-891):
```
These reentrancy warnings concern LoanPriceOracle and LPToken, which are
trusted contracts, deployed with the Vault.

--------------------------------------------------------------------------------

```
Reentrancy in Vault.withdrawCollateral(address,uint256) (contracts/Vault.sol#900-927):
Reentrancy in Vault.onLoanExpired(address,uint256) (contracts/Vault.sol#976-1019):
```
These methods are protected by a reentrancy guard.

--------------------------------------------------------------------------------

```
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1062-1105) has external calls inside a loop: noteAdapter.isRepaid(loanId) (contracts/Vault.sol#1093)
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1062-1105) has external calls inside a loop: noteAdapter.isExpired(loanId) (contracts/Vault.sol#1096)
```
This method is intended only to be used off-chain.

--------------------------------------------------------------------------------

```
LoanPriceOracle._computeRateComponent(LoanPriceOracle.PiecewiseLinearModel,uint256,uint256) (contracts/LoanPriceOracle.sol#139-153) uses timestamp for comparisons
LoanPriceOracle.priceLoan(address,uint256,uint256,uint256,uint256,uint256,uint256) (contracts/LoanPriceOracle.sol#182-231) uses timestamp for comparisons
Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#690-777) uses timestamp for comparisons
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1062-1105) uses timestamp for comparisons
```
Timestamps are necessary for computing the loan maturity time bucket, loan
duration remaining, and the loan purchase price, and those results are
subsequently used in some comparisons.
