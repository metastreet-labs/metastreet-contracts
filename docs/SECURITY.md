# Security Notes

## `solhint` Warning Review

### `contracts/Vault.sol`

```
   937:32  warning  Avoid to use low level calls                                       avoid-low-level-calls

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
  1033:28  warning  Avoid to use low level calls                                       avoid-low-level-calls

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
Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#701-795) performs a multiplication on the result of a division:
```
This is a required operation for the senior tranche return calculation.

--------------------------------------------------------------------------------

```
Reentrancy in Vault.sellNoteAndDeposit(address,uint256,uint256,uint256[2]) (contracts/Vault.sol#833-855):
```
This reentrancy warning concerns LPToken, which is a trusted contract deployed
with the Vault.

--------------------------------------------------------------------------------

```
Reentrancy in Vault.withdrawCollateral(address,uint256) (contracts/Vault.sol#918-945):
Reentrancy in Vault.onLoanExpired(address,uint256) (contracts/Vault.sol#994-1037):
```
These methods are protected by a reentrancy guard.

--------------------------------------------------------------------------------

```
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1080-1121) has external calls inside a loop: noteAdapter.isRepaid(loanId) (contracts/Vault.sol#1109)
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1080-1121) has external calls inside a loop: noteAdapter.isExpired(loanId) (contracts/Vault.sol#1112)
```
This method is intended only to be used off-chain.

--------------------------------------------------------------------------------

```
LoanPriceOracle._computeRateComponent(LoanPriceOracle.PiecewiseLinearModel,uint256,uint256) (contracts/LoanPriceOracle.sol#159-173) uses timestamp for comparisons
LoanPriceOracle.priceLoan(address,uint256,uint256,uint256,uint256,uint256,uint256) (contracts/LoanPriceOracle.sol#202-251) uses timestamp for comparisons
Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#701-795) uses timestamp for comparisons
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1080-1121) uses timestamp for comparisons
```
Timestamps are necessary for computing the loan maturity time bucket, loan
duration remaining, and the loan purchase price, and those results are
subsequently used in some comparisons.
