# MetaStreet Contracts

## Prerequisites

Node v16 or below. Hardhat doesn't work with Node v17 currently: [hardhat#1988](https://github.com/nomiclabs/hardhat/issues/1988).

## Usage

Install:

```
npm install
```

Compile contracts:

```
npm run build
```

Run unit tests:

```
npm test
```

Start hardhat network:

```
npm run node
```

Deploy simulation environment (after starting hardhat network in another shell):

```
npx hardhat run --network localhost scripts/deploy-simulation.ts
```

## Additional Targets

- Format contracts (prettier): `npm run format`
- Lint contracts (solhint): `npm run lint`
- Run unit tests with coverage (solidity-coverage): `npm run test:coverage`
- Run static analyzer (slither, requires external installation): `npm run analyze`
- Format tests and scripts (prettier): `npm run format:ts`
- Lint tests and scripts (eslint): `npm run lint:ts`

## File Structure

- [`contracts/`](contracts/) - Smart Contracts
  - [`interfaces/`](contracts/interfaces) - Interfaces
    - [`INoteAdapter.sol`](contracts/interfaces/INoteAdapter.sol) - NoteAdapter interface
    - [`ILoanPriceOracle.sol`](contracts/interfaces/ILoanPriceOracle.sol) - LoanPriceOracle interface
    - [`IVault.sol`](contracts/interfaces/IVault.sol) - Vault interface
  - [`LoanPriceOracle.sol`](contracts/LoanPriceOracle.sol) - LoanPriceOracle implementation
  - [`LPToken.sol`](contracts/LPToken.sol) - LPToken implementation
  - [`Vault.sol`](contracts/Vault.sol) - Vault implementation
  - [`test/`](contracts/test/) - Testing contracts
    - [`lending/`](contracts/test/lending/) - Test lending platform
      - [`TestNoteToken.sol`](contracts/test/lending/TestNoteToken.sol) - Note token for TestLendingPlatform
      - [`TestLendingPlatform.sol`](contracts/test/lending/TestLendingPlatform.sol) - TestLendingPlatform implementation
      - [`TestNoteAdapter.sol`](contracts/test/lending/TestNoteAdapter.sol) - Note adapter for TestLendingPlatform
    - [`TestERC20.sol`](contracts/test/TestERC20.sol) - Test ERC20 token
    - [`TestERC721.sol`](contracts/test/TestERC721.sol) - Test ERC721 token
    - [`thirdparty/`](contracts/test/thirdparty/) - External integrations
- [`test/`](test/) - Unit tests
  - [`TestLendingPlatform.spec.ts`](test/TestLendingPlatform.spec.ts) - TestLendingPlatform unit tests
  - [`LoanPriceOracle.spec.ts`](test/LoanPriceOracle.spec.ts) - LoanPriceOracle unit tests
  - [`Vault.spec.ts`](test/Vault.spec.ts) - Vault unit tests
  - [`helpers/`](test/helpers/) - Test helpers
    - [`EventUtilities.ts`](test/helpers/EventUtilities.ts) - Event helper functions
- [`scripts/`](scripts/) - Scripts
  - [`deploy-simulation.ts`](scripts/deploy-simulation.ts) - Simulation deployment
  - [`estimate-gas-costs.ts`](scripts/estimate-gas-costs.ts) - Gas cost estimator
- [`hardhat.config.ts`](hardhat.config.ts) - Hardhat configuration
- [`tsconfig.json`](tsconfig.json) - TypeScript configuration
- [`package.json`](package.json) - npm package metadata
- [`package-lock.json`](package-lock.json) - npm package lock
- [`README.md`](README.md) - This README

## License

TBD
