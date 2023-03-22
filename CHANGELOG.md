* NFTfiV2NoteAdapter v1.4 - 03/15/2023
    * Add support for collateral bundles.

* Vault v1.5 - 02/27/2023
    * Add support for optional note seller approval.

* XY3NoteAdapter v1.0 - 02/23/2023
    * Initial release.

* ArcadeV2NoteAdapter v1.2 - 12/08/2022
    * Add `UnreportedCollateralInventory()` error for collateral bundles missing
      inventory reporting.

* NFTfiV2NoteAdapter v1.3 - 11/30/2022
    * Add support for `DIRECT_LOAN_FIXED_COLLECTION` loan type for loans made
      from collection offers.

* Vault v1.4 - 11/21/2022
    * Add `getLoanAssets()` API to INoteAdapter.
    * Add `priceNote()` getter API to IVault.
    * Add support for pricing collateral bundles.
* ArcadeV2NoteAdapter v1.1 - 11/21/2022
    * Implement new `getLoanAssets()` API in INoteAdapter.
    * Add support for collateral bundles.
* NFTfiV2NoteAdapter v1.2 - 11/21/2022
    * Implement new `getLoanAssets()` API in INoteAdapter.

* Vault v1.3 - 11/18/2022
    * Add default constructor to disable initialization of implementation
      contract.
* LPToken v1.1 - 11/18/2022
    * Add default constructor to disable initialization of implementation
      contract.

* LoanPriceOracle v1.2 - 10/31/2022
    * Add purchase price validation to `priceLoan()`.

* NFTfiV2NoteAdapter v1.1 - 09/24/2022
    * Improve support for loan contract upgrades by modifying getters to look
      up loan contract dynamically.
    * Update supported loan type key to new loan contract deployment.

* Vault v1.2 - 08/25/2022
    * Add additional `utilization()` getter to return utilization computed with
      additional loan balance.

* Vault v1.1 - 07/25/2022
    * Modify `sellNote()` and `sellNoteAndDeposit()` APIs to return executed
      purchase price.

* LoanPriceOracle v1.1 - 07/19/2022
    * Add `priceLoanRepayment()` API.

* LoanPriceOracle v1.0 - 05/31/2022
    * Initial release.
* Vault v1.0 - 05/31/2022
    * Initial release.
