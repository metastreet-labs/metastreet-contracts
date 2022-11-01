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
