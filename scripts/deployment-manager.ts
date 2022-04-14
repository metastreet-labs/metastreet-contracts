import { ethers, upgrades } from "hardhat";
import { Command, InvalidArgumentError } from "commander";
import fs from "fs";

import { BigNumber } from "@ethersproject/bignumber";
import { Network } from "@ethersproject/networks";

import { Vault, LoanPriceOracle } from "../typechain";

import { FixedPoint } from "../test/helpers/FixedPointHelpers";
import {
  CollateralParameters,
  PiecewiseLinearModel,
  encodeCollateralParameters,
  computePiecewiseLinearModel,
} from "../test/helpers/LoanPriceOracleHelpers";

/******************************************************************************/
/* Deployment */
/******************************************************************************/

class Deployment {
  name?: string;
  chainId?: number;
  vaultBeacon?: string;
  lpTokenBeacon?: string;
  vaults?: string[];

  constructor(
    name: string | undefined = undefined,
    chainId: number | undefined = undefined,
    vaultBeacon: string | undefined = undefined,
    lpTokenBeacon: string | undefined = undefined,
    vaults: string[] | undefined = undefined
  ) {
    this.name = name;
    this.chainId = chainId;
    this.vaultBeacon = vaultBeacon;
    this.lpTokenBeacon = lpTokenBeacon;
    this.vaults = vaults;
  }

  static fromFile(path: string): Deployment {
    const obj: Deployment = JSON.parse(fs.readFileSync(path, "utf-8"));
    return new Deployment(obj.name, obj.chainId, obj.vaultBeacon, obj.lpTokenBeacon, obj.vaults);
  }

  static fromScratch(network: Network): Deployment {
    return new Deployment(network.name, network.chainId);
  }

  toFile(path: string) {
    fs.writeFileSync(path, JSON.stringify(this), { encoding: "utf-8" });
  }

  dump() {
    console.log(`Network:         ${this.name}`);
    console.log(`Chain ID:        ${this.chainId}`);
    console.log(`Vault Beacon:    ${this.vaultBeacon || "Not deployed"}`);
    console.log(`LPToken Beacon:  ${this.lpTokenBeacon || "Not deployed"}`);
    if (this.vaults) {
      console.log("Vaults:");
      for (const vaultAddress of this.vaults) {
        console.log(`  ${vaultAddress}`);
      }
    }
  }
}

/******************************************************************************/
/* Beacon Functions */
/******************************************************************************/

async function beaconDeploy(deployment: Deployment) {
  if (deployment.vaultBeacon && deployment.lpTokenBeacon) {
    console.log("Beacons already deployed.");
    return;
  }

  const vaultFactory = await ethers.getContractFactory("Vault");
  const lpTokenFactory = await ethers.getContractFactory("LPToken");

  const vaultBeacon = await upgrades.deployBeacon(vaultFactory, { unsafeAllow: ["delegatecall"] });
  await vaultBeacon.deployed();

  const lpTokenBeacon = await upgrades.deployBeacon(lpTokenFactory);
  await lpTokenBeacon.deployed();

  deployment.vaultBeacon = vaultBeacon.address;
  deployment.lpTokenBeacon = lpTokenBeacon.address;
}

async function beaconShow(deployment: Deployment) {
  async function getImplementationInfo(beaconAddress: string): Promise<{ address: string; version: string }> {
    const address = await upgrades.beacon.getImplementationAddress(beaconAddress);
    const impl = await ethers.getContractAt(["function IMPLEMENTATION_VERSION() view returns (string)"], address);
    const version = await impl.IMPLEMENTATION_VERSION();
    return { address, version };
  }

  async function formatBeacon(beaconAddress: string): Promise<void> {
    const implInfo = await getImplementationInfo(beaconAddress);
    console.log(`  Beacon:  ${beaconAddress}`);
    console.log(`  Impl.:   ${implInfo.address}`);
    console.log(`  Version: ${implInfo.version}`);
  }

  if (deployment.vaultBeacon) {
    console.log("Vault");
    await formatBeacon(deployment.vaultBeacon);
  }

  if (deployment.lpTokenBeacon) {
    console.log("LPToken");
    await formatBeacon(deployment.lpTokenBeacon);
  }
}

async function beaconUpgrade(_: Deployment) {
  console.log("Not implemented.");
}

/******************************************************************************/
/* Vault Functions */
/******************************************************************************/

async function vaultDeploy(
  deployment: Deployment,
  name: string,
  currencyToken: string,
  seniorLPSymbol: string,
  juniorLPSymbol: string
) {
  if (!deployment.lpTokenBeacon || !deployment.vaultBeacon) {
    console.error("Beacons not yet deployed.");
    return;
  }

  const loanPriceOracleFactory = await ethers.getContractFactory("LoanPriceOracle");
  const lpTokenFactory = await ethers.getContractFactory("LPToken");
  const vaultFactory = await ethers.getContractFactory("Vault");

  const loanPriceOracle = await loanPriceOracleFactory.deploy(currencyToken);
  await loanPriceOracle.deployed();
  console.debug(`Loan Price Oracle: ${loanPriceOracle.address}`);

  const seniorLPToken = await upgrades.deployBeaconProxy(deployment.lpTokenBeacon, lpTokenFactory, [
    "Senior LP Token",
    seniorLPSymbol,
  ]);
  await seniorLPToken.deployed();
  console.debug(`Senior LP Token:   ${seniorLPToken.address}`);

  const juniorLPToken = await upgrades.deployBeaconProxy(deployment.lpTokenBeacon, lpTokenFactory, [
    "Junior LP Token",
    juniorLPSymbol,
  ]);
  await juniorLPToken.deployed();
  console.debug(`Junior LP Token:   ${juniorLPToken.address}`);
  console.debug();

  const vault = await upgrades.deployBeaconProxy(deployment.vaultBeacon, vaultFactory, [
    name,
    currencyToken,
    loanPriceOracle.address,
    seniorLPToken.address,
    juniorLPToken.address,
  ]);
  await vault.deployed();

  console.log(vault.address);

  deployment.vaults = deployment.vaults ? [...deployment.vaults, vault.address] : [vault.address];
}

async function vaultList(deployment: Deployment) {
  for (const vaultAddress of deployment.vaults || []) {
    const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
    const vaultName = await vault.name();
    const currencyToken = await vault.currencyToken();
    const currencyTokenSymbol = await (await ethers.getContractAt("IERC20Metadata", currencyToken)).symbol();
    console.log(
      `${vaultAddress} | ${vaultName.padEnd(16)} | Currency Token: ${currencyToken} (${currencyTokenSymbol})`
    );
  }
}

async function vaultInfo(vaultAddress: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;

  const implVersion = await vault.IMPLEMENTATION_VERSION();
  const vaultName = await vault.name();
  const currencyToken = await vault.currencyToken();
  const currencyTokenSymbol = await (await ethers.getContractAt("IERC20Metadata", currencyToken)).symbol();
  const seniorLPToken = await vault.lpToken(0);
  const seniorLPTokenSymbol = await (await ethers.getContractAt("IERC20Metadata", seniorLPToken)).symbol();
  const juniorLPToken = await vault.lpToken(1);
  const juniorLPTokenSymbol = await (await ethers.getContractAt("IERC20Metadata", juniorLPToken)).symbol();
  const seniorTrancheRate = (await vault.seniorTrancheRate()).mul(365 * 86400);

  console.log("Vault");
  console.log(`  Name:                ${vaultName}`);
  console.log(`  Impl. Version:       ${implVersion}`);
  console.log(`  Currency Token:      ${currencyToken} (${currencyTokenSymbol})`);
  console.log(`  Senior LP Token:     ${seniorLPToken} (${seniorLPTokenSymbol})`);
  console.log(`  Junior LP Token:     ${juniorLPToken} (${juniorLPTokenSymbol})`);
  console.log(`  Senior Tranche Rate: ${ethers.utils.formatEther(seniorTrancheRate.mul(100))}%`);
}

async function vaultSetNoteAdapter(vaultAddress: string, noteToken: string, noteAdapter: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  await vault.setNoteAdapter(noteToken, noteAdapter);
}

async function vaultSetSeniorTrancheRate(vaultAddress: string, rate: BigNumber) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  await vault.setSeniorTrancheRate(rate.div(365 * 86400));
}

async function vaultSetAdminFeeRate(vaultAddress: string, rate: BigNumber) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  await vault.setAdminFeeRate(rate);
}

async function vaultAddCollateralLiquidator(vaultAddress: string, liquidator: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  await vault.grantRole(await vault.COLLATERAL_LIQUIDATOR_ROLE(), liquidator);
}

async function vaultRemoveCollateralLiquidator(vaultAddress: string, liquidator: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  await vault.revokeRole(await vault.COLLATERAL_LIQUIDATOR_ROLE(), liquidator);
}

/******************************************************************************/
/* Loan Price Oracle Functions */
/******************************************************************************/

async function vaultLpoInfo(vaultAddress: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle()
  )) as LoanPriceOracle;

  const implVersion = await loanPriceOracle.IMPLEMENTATION_VERSION();
  const currencyToken = await loanPriceOracle.currencyToken();
  const currencyTokenSymbol = await (await ethers.getContractAt("IERC20Metadata", currencyToken)).symbol();
  const minimumDiscountRate = (await loanPriceOracle.minimumDiscountRate()).mul(365 * 86400);
  const minimumLoanDuration = await loanPriceOracle.minimumLoanDuration();

  console.log("LoanPriceOracle");
  console.log(`  Impl. Version:      ${implVersion}`);
  console.log(`  Currency Token:     ${currencyToken} (${currencyTokenSymbol})`);
  console.log(`  Min. Discount Rate: ${ethers.utils.formatEther(minimumDiscountRate.mul(100))}%`);
  console.log(`  Min. Loan Duration: ${minimumLoanDuration.div(86400)} days (${minimumLoanDuration} seconds)`);
}

async function vaultLpoSetMinimumDiscountRate(vaultAddress: string, rate: BigNumber) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle()
  )) as LoanPriceOracle;
  await loanPriceOracle.setMinimumDiscountRate(rate.div(365 * 86400));
}

async function vaultLpoSetMinimumLoanDuration(vaultAddress: string, duration: number) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle()
  )) as LoanPriceOracle;
  await loanPriceOracle.setMinimumLoanDuration(duration);
}

async function vaultLpoSetCollateralParameters(vaultAddress: string, token: string, path: string) {
  type SerializedPiecewiseLinearModel = {
    minRate: string;
    targetRate: string;
    maxRate: string;
    target: string;
    max: string;
  };

  type SerializedCollateralParameters = {
    collateralValue: string;
    utilizationRateComponent: SerializedPiecewiseLinearModel;
    loanToValueRateComponent: SerializedPiecewiseLinearModel;
    durationRateComponent: SerializedPiecewiseLinearModel;
    rateComponentWeights: [number, number, number];
  };

  function deserializePiecewiseLinearModel(serialized: SerializedPiecewiseLinearModel): PiecewiseLinearModel {
    return computePiecewiseLinearModel({
      minRate: FixedPoint.normalizeRate(serialized.minRate),
      targetRate: FixedPoint.normalizeRate(serialized.targetRate),
      maxRate: FixedPoint.normalizeRate(serialized.maxRate),
      target: FixedPoint.from(serialized.target),
      max: FixedPoint.from(serialized.max),
    });
  }

  function deserializeCollateralParameters(serialized: SerializedCollateralParameters): CollateralParameters {
    return {
      collateralValue: ethers.utils.parseEther(serialized.collateralValue),
      utilizationRateComponent: deserializePiecewiseLinearModel(serialized.utilizationRateComponent),
      loanToValueRateComponent: deserializePiecewiseLinearModel(serialized.loanToValueRateComponent),
      durationRateComponent: deserializePiecewiseLinearModel(serialized.durationRateComponent),
      rateComponentWeights: serialized.rateComponentWeights,
    };
  }

  const serialized: SerializedCollateralParameters = JSON.parse(fs.readFileSync(path, "utf-8"));
  const collateralParameters = deserializeCollateralParameters(serialized);

  console.log("Collateral Parameters:");
  console.log(collateralParameters);

  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle()
  )) as LoanPriceOracle;
  await loanPriceOracle.setCollateralParameters(token, encodeCollateralParameters(collateralParameters));
}

/******************************************************************************/
/* Note Adapter Functions */
/******************************************************************************/

async function noteAdapterDeploy(contractName: string, ...args: string[]) {
  const noteAdapterFactory = await ethers.getContractFactory(contractName);

  const noteAdapter = await noteAdapterFactory.deploy(...args[0]);
  await noteAdapter.deployed();

  console.log(noteAdapter.address);
}

/******************************************************************************/
/* Parsers for Arguments */
/******************************************************************************/

function parseAddress(address: string, _: string): string {
  if (!ethers.utils.isAddress(address)) {
    throw new InvalidArgumentError("Invalid address.");
  }
  return ethers.utils.getAddress(address);
}

function parseDecimal(decimal: string, _: string): BigNumber {
  try {
    return FixedPoint.from(decimal);
  } catch (e) {
    throw new InvalidArgumentError("Invalid decimal: " + e);
  }
}

function parseNumber(value: string, _: string) {
  const parsedValue = parseInt(value, 10);
  if (isNaN(parsedValue)) {
    throw new InvalidArgumentError("Invalid number.");
  }
  return parsedValue;
}

/******************************************************************************/
/* Entry Point */
/******************************************************************************/

async function main() {
  /* Load deployment */
  const network = await ethers.provider.getNetwork();
  const deploymentPath = `deployments/${network.name}-${network.chainId}.json`;
  const deployment: Deployment = fs.existsSync(deploymentPath)
    ? Deployment.fromFile(deploymentPath)
    : Deployment.fromScratch(network);

  /* Program Commands */
  const program = new Command();

  program.name("deployment-manager").description("CLI for Vault deployment").version("0.1.0");

  program
    .command("show")
    .description("Show current deployment")
    .action(() => deployment.dump());

  program
    .command("beacon-deploy")
    .description("Deploy beacons")
    .action(() => beaconDeploy(deployment));
  program
    .command("beacon-show")
    .description("Show beacons")
    .action(() => beaconShow(deployment));
  program
    .command("beacon-upgrade")
    .description("Upgrade beacon implementations")
    .action(() => beaconUpgrade(deployment));

  program
    .command("vault-deploy")
    .description("Deploy Vault")
    .argument("name", "Name of Vault")
    .argument("currency_token", "Currency token address", parseAddress)
    .argument("senior_lp_symbol", "Senior LPToken symbol")
    .argument("junior_lp_symbol", "Junior LPToken symbol")
    .action((name, currencyToken, seniorLPSymbol, juniorLPSymbol) =>
      vaultDeploy(deployment, name, currencyToken, seniorLPSymbol, juniorLPSymbol)
    );
  program
    .command("vault-list")
    .description("List deployed Vaults")
    .action(() => vaultList(deployment));
  program
    .command("vault-info")
    .argument("vault", "Vault address", parseAddress)
    .description("Dump Vault information")
    .action(vaultInfo);
  program
    .command("vault-set-senior-tranche-rate")
    .description("Set Vault senior tranche rate")
    .argument("vault", "Vault address", parseAddress)
    .argument("rate", "Senior tranche interest rate (APR)", parseDecimal)
    .action(vaultSetSeniorTrancheRate);
  program
    .command("vault-set-admin-fee-rate")
    .description("Set Vault admin fee rate")
    .argument("vault", "Vault address", parseAddress)
    .argument("rate", "Admin fee rate (fraction of interest)", parseDecimal)
    .action(vaultSetAdminFeeRate);
  program
    .command("vault-set-note-adapter")
    .description("Set Vault note adapter")
    .argument("vault", "Vault address", parseAddress)
    .argument("note_token", "Note token address", parseAddress)
    .argument("note_adapter", "Note adapter address", parseAddress)
    .action(vaultSetNoteAdapter);
  program
    .command("vault-add-collateral-liquidator")
    .description("Add Vault collateral liquidator")
    .argument("vault", "Vault address", parseAddress)
    .argument("liquidator", "Collateral liquidator address", parseAddress)
    .action(vaultAddCollateralLiquidator);
  program
    .command("vault-remove-collateral-liquidator")
    .description("Remove Vault collateral liquidator")
    .argument("vault", "Vault address", parseAddress)
    .argument("liquidator", "Collateral liquidator address", parseAddress)
    .action(vaultRemoveCollateralLiquidator);

  program
    .command("vault-lpo-info")
    .description("Dump Vault Loan Price Oracle information")
    .argument("vault", "Vault address", parseAddress)
    .action(vaultLpoInfo);
  program
    .command("vault-lpo-set-minimum-discount-rate")
    .description("Set Vault Loan Price Oracle minimum discount rate")
    .argument("vault", "Vault address", parseAddress)
    .argument("rate", "Minimum discount rate (APR)", parseDecimal)
    .action(vaultLpoSetMinimumDiscountRate);
  program
    .command("vault-lpo-set-minimum-loan-duration")
    .description("Set Vault Loan Price Oracle minimum loan duration")
    .argument("vault", "Vault address", parseAddress)
    .argument("duration", "Minimum loan duration (in seconds)", parseNumber)
    .action(vaultLpoSetMinimumLoanDuration);
  program
    .command("vault-lpo-set-collateral-parameters")
    .description("Set Vault Loan Price Oracle collateral parameters")
    .argument("vault", "Vault address", parseAddress)
    .argument("token", "Collateral token address", parseAddress)
    .argument("path", "Path to JSON parameters")
    .action(vaultLpoSetCollateralParameters);

  program
    .command("note-adapter-deploy")
    .description("Deploy Note Adapter")
    .argument("contract", "Note adapter contract name")
    .argument("args...", "Arguments")
    .action(noteAdapterDeploy);

  /* Parse command */
  await program.parseAsync(process.argv);

  /* Save deployment */
  deployment.toFile(deploymentPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
