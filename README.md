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

* Format contracts (prettier): `npm run format`
* Lint contracts (solhint): `npm run lint`
* Run unit tests with coverage (solidity-coverage): `npm run test:coverage`
* Run static analyzer (slither, requires external installation): `npm run analyze`
* Format tests and scripts (prettier): `npm run format:ts`
* Lint tests and scripts (eslint): `npm run lint:ts`

## File Structure

TBD

## License

TBD
