# MetaStreet Contracts

## Usage

Install:

```
npm install
```

Compile contracts:

```
npx hardhat compile
```

Run unit tests:

```
npx hardhat test
```

Start hardhat network:

_You have to use Node v16 or below. Hardhat doesn't work with Node v17 currently: [hardhat#1988](https://github.com/nomiclabs/hardhat/issues/1988)_
```
npx hardhat node
```

Deploy simulation environment (after starting hardhat network in another shell):

```
npx hardhat run --network localhost scripts/deploy-simulation.ts
```

## File Structure

TBD

## License

TBD
