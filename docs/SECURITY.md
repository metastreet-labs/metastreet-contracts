# Security Notes

## `solhint` Warning Review

### `contracts/Vault.sol`

```
  746:28  warning  Avoid to use low level calls                                       avoid-low-level-calls

    function liquidateLoan(IERC721 noteToken, uint256 noteTokenId) public nonReentrant {
        ...
        (bool success, ) = noteAdapter.lendingPlatform().call(noteAdapter.getLiquidateCalldata(noteTokenId));
        ...
    }
```
This low-level `call()` is used to liquidate a loan on the lending platform by
the Vault. In order to have generic support for multiple lending platforms, the
liquidation calldata must be constructed by the note adapter, and subsequently
requires a low-level call to execute it from the Vault.

--------------------------------------------------------------------------------

```
  942:55  warning  Avoid to use low level calls                                       avoid-low-level-calls
  947:21  warning  Avoid to use inline assembly. It is acceptable only in rare cases  no-inline-assembly

    function multicall(bytes[] calldata data) public returns (bytes[] memory results) {
        ...
            (bool success, bytes memory returndata) = address(this).delegatecall(data[i]);
        ...
                    assembly {
                        let returndata_size := mload(returndata)
                        revert(add(32, returndata), returndata_size)
                    }
        ...
    }
```
This low-level `delegatecall()` and assembly is required for the inlined
implementation of `multicall()`.

## `slither` Warning Review

```
Vault (contracts/Vault.sol#126-1068) is an upgradeable contract that does not protect its initiliaze functions: Vault.initialize(string,IERC20,ILoanPriceOracle,LPToken,LPToken) (contracts/Vault.sol#209-233). Anyone can delete the contract with: Vault.multicall(bytes[]) (contracts/Vault.sol#944-963)Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#unprotected-upgradeable-contract
```
This appears to be a false positive? The `initialize()` function has an
`initializer` modifier, and the `multicall()` is hardcoded to only operate on
`address(this)`.

--------------------------------------------------------------------------------

```
Vault._sellNote(IERC721,uint256,uint256) (contracts/Vault.sol#548-630) performs a multiplication on the result of a division:
```
This is a required operation for the senior tranche return calculation.

--------------------------------------------------------------------------------

```
LoanPriceOracle.priceLoan(address,uint256,uint256,uint256,uint256,uint256,uint256) (contracts/LoanPriceOracle.sol#160-220) uses a dangerous strict equality:
	- rateComponents[0] == type()(uint256).max (contracts/LoanPriceOracle.sol#199)
	- rateComponents[1] == type()(uint256).max (contracts/LoanPriceOracle.sol#202)
	- rateComponents[2] == type()(uint256).max (contracts/LoanPriceOracle.sol#205)
```
These strict equalities are used to check for the error returned by
`_computeRateComponent()`, when the input value exceeds the model max.

--------------------------------------------------------------------------------

```
Reentrancy in Vault._deposit(IVault.TrancheId,uint256) (contracts/Vault.sol#519-539):
Reentrancy in Vault._sellNote(IERC721,uint256,uint256) (contracts/Vault.sol#548-630):
Reentrancy in Vault.sellNoteAndDeposit(IERC721,uint256,uint256[2]) (contracts/Vault.sol#668-685):
Reentrancy in Vault.redeem(IVault.TrancheId,uint256) (contracts/Vault.sol#690-713):
Reentrancy in Vault.withdraw(IVault.TrancheId,uint256) (contracts/Vault.sol#718-731):
```
These reentrancy warnings concern LoanPriceOracle and LPToken, which are
trusted contracts, deployed with the Vault.

--------------------------------------------------------------------------------

```
Reentrancy in Vault.liquidateLoan(IERC721,uint256) (contracts/Vault.sol#740-752):
```
This method is protected by a reentrancy guard.

--------------------------------------------------------------------------------

```
LoanPriceOracle._computeRateComponent(LoanPriceOracle.PiecewiseLinearModel,uint256) (contracts/LoanPriceOracle.sol#124-131) uses timestamp for comparisons
LoanPriceOracle.priceLoan(address,uint256,uint256,uint256,uint256,uint256,uint256) (contracts/LoanPriceOracle.sol#160-220) uses timestamp for comparisons
Vault._deposit(IVault.TrancheId,uint256) (contracts/Vault.sol#519-539) uses timestamp for comparisons
Vault._sellNote(IERC721,uint256,uint256) (contracts/Vault.sol#548-630) uses timestamp for comparisons
```
Timestamps are necessary for computing the share price or a loan purchase
price, and those results are subsequently used in some comparisons.
