# Security Notes

## `solhint` Warning Review

### `contracts/Vault.sol`

```
  895:28  warning  Avoid to use low level calls                                       avoid-low-level-calls

    function liquidateLoan(address noteToken, uint256 noteTokenId) external nonReentrant {
        ...
        (address target, bytes memory data) = noteAdapter.getLiquidateCalldata(noteTokenId);
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
Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#681-764) performs a multiplication on the result of a division:
```
This is a required operation for the senior tranche return calculation.

--------------------------------------------------------------------------------

```
Reentrancy in Vault._deposit(IVault.TrancheId,uint256) (contracts/Vault.sol#773-779):
Reentrancy in Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#681-764):
Reentrancy in Vault.sellNoteAndDeposit(address,uint256,uint256,uint256[2]) (contracts/Vault.sol#802-824):
Reentrancy in Vault.redeem(IVault.TrancheId,uint256) (contracts/Vault.sol#829-854):
Reentrancy in Vault.withdraw(IVault.TrancheId,uint256) (contracts/Vault.sol#859-878):
```
These reentrancy warnings concern LoanPriceOracle and LPToken, which are
trusted contracts, deployed with the Vault.

--------------------------------------------------------------------------------

```
Reentrancy in Vault.liquidateLoan(address,uint256) (contracts/Vault.sol#887-900):
```
This method is protected by a reentrancy guard.

--------------------------------------------------------------------------------

```
LoanPriceOracle._computeRateComponent(LoanPriceOracle.PiecewiseLinearModel,uint256,uint256) (contracts/LoanPriceOracle.sol#139-153) uses timestamp for comparisons
LoanPriceOracle.priceLoan(address,uint256,uint256,uint256,uint256,uint256,uint256) (contracts/LoanPriceOracle.sol#182-231) uses timestamp for comparisons
Vault._sellNote(address,uint256,uint256) (contracts/Vault.sol#681-764) uses timestamp for comparisons
```
Timestamps are necessary for computing the loan duration remaining and the loan
purchase price, and those results are subsequently used in some comparisons.
