# Security Notes

## `solhint` Warning Review

### `contracts/Vault.sol`

```
  1012:28  warning  Avoid to use low level calls                                       avoid-low-level-calls

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
Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#698-783) performs a multiplication on the result of a division:
```
This is a required operation for the senior tranche return calculation.

--------------------------------------------------------------------------------

```
Reentrancy in Vault._deposit(IVault.TrancheId,uint256) (contracts/Vault.sol#669-689):
Reentrancy in Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#698-783):
Reentrancy in Vault.sellNoteAndDeposit(address,uint256,uint256,uint256[2]) (contracts/Vault.sol#821-843):
Reentrancy in Vault.redeem(IVault.TrancheId,uint256) (contracts/Vault.sol#848-873):
Reentrancy in Vault.withdraw(IVault.TrancheId,uint256) (contracts/Vault.sol#878-897):
```
These reentrancy warnings concern LoanPriceOracle and LPToken, which are
trusted contracts, deployed with the Vault.

--------------------------------------------------------------------------------

```
Reentrancy in Vault.onLoanExpired(address,uint256) (contracts/Vault.sol#1004-1017):
```
This method is protected by a reentrancy guard.

--------------------------------------------------------------------------------

```
LoanPriceOracle._computeRateComponent(LoanPriceOracle.PiecewiseLinearModel,uint256,uint256) (contracts/LoanPriceOracle.sol#139-153) uses timestamp for comparisons
LoanPriceOracle.priceLoan(address,uint256,uint256,uint256,uint256,uint256,uint256) (contracts/LoanPriceOracle.sol#182-231) uses timestamp for comparisons
Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#698-783) uses timestamp for comparisons
Vault.checkUpkeep(bytes) (contracts/Vault.sol#1060-1102) uses timestamp for comparisons
```
Timestamps are necessary for computing the loan maturity time bucket, loan
duration remaining, and the loan purchase price, and those results are
subsequently used in some comparisons.
