import { ethers, upgrades } from "hardhat";
import { Command, InvalidArgumentError } from "commander";
import fs from "fs";

import { BigNumber } from "@ethersproject/bignumber";
import { Network } from "@ethersproject/networks";
import { Signer } from "@ethersproject/abstract-signer";
import { getContractAddress } from "@ethersproject/address";
import { LedgerSigner } from "@anders-t/ethers-ledger";

import {
  VaultRegistry,
  Vault,
  LoanPriceOracle,
  StaticCollateralOracle,
  IVault,
  INoteAdapter,
  ILoanPriceOracle,
} from "../typechain";

import { FixedPoint } from "../test/helpers/FixedPointHelpers";
import {
  UtilizationParameters,
  CollateralParameters,
  PiecewiseLinearModel,
  encodeUtilizationParameters,
  encodeCollateralParameters,
  computePiecewiseLinearModel,
} from "../test/helpers/LoanPriceOracleHelpers";

/******************************************************************************/
/* Global Signer */
/******************************************************************************/

let signer: Signer | undefined;

/******************************************************************************/
/* Deployment */
/******************************************************************************/

class Deployment {
  name?: string;
  chainId?: number;
  vaultBeacon?: string;
  lpTokenBeacon?: string;
  vaultRegistry?: string;

  constructor(
    name: string | undefined = undefined,
    chainId: number | undefined = undefined,
    vaultBeacon: string | undefined = undefined,
    lpTokenBeacon: string | undefined = undefined,
    vaultRegistry: string | undefined = undefined
  ) {
    this.name = name;
    this.chainId = chainId;
    this.vaultBeacon = vaultBeacon;
    this.lpTokenBeacon = lpTokenBeacon;
    this.vaultRegistry = vaultRegistry;
  }

  static fromFile(path: string): Deployment {
    const obj: Deployment = JSON.parse(fs.readFileSync(path, "utf-8"));
    return new Deployment(obj.name, obj.chainId, obj.vaultBeacon, obj.lpTokenBeacon, obj.vaultRegistry);
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
    console.log(`Vault Registry:  ${this.vaultRegistry || "Not deployed"}`);
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

  const vaultFactory = await ethers.getContractFactory("Vault", signer);
  const lpTokenFactory = await ethers.getContractFactory("LPToken", signer);

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

async function beaconUpgradeVault(deployment: Deployment) {
  if (!deployment.vaultBeacon) {
    console.error("Beacon not yet deployed.");
    return;
  }

  const vaultFactory = await ethers.getContractFactory("Vault", signer);
  await upgrades.upgradeBeacon(deployment.vaultBeacon, vaultFactory, { unsafeAllow: ["delegatecall"] });
}

async function beaconUpgradeLPToken(deployment: Deployment) {
  if (!deployment.lpTokenBeacon) {
    console.error("Beacon not yet deployed.");
    return;
  }

  const lpTokenFactory = await ethers.getContractFactory("LPToken", signer);
  await upgrades.upgradeBeacon(deployment.lpTokenBeacon, lpTokenFactory, { unsafeAllow: ["delegatecall"] });
}

/******************************************************************************/
/* Registry Functions */
/******************************************************************************/

async function registryDeploy(deployment: Deployment) {
  if (deployment.vaultRegistry) {
    console.log("Vault registry already deployed.");
    return;
  }

  const vaultRegistryFactory = await ethers.getContractFactory("VaultRegistry", signer);

  const vaultRegistry = await vaultRegistryFactory.deploy();
  await vaultRegistry.deployed();

  deployment.vaultRegistry = vaultRegistry.address;
}

async function registryList(deployment: Deployment) {
  if (!deployment.vaultRegistry) {
    return;
  }

  const vaultRegistry = (await ethers.getContractAt("VaultRegistry", deployment.vaultRegistry)) as VaultRegistry;
  const vaults = await vaultRegistry.getVaultList();

  for (const vaultAddress of vaults) {
    const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
    const vaultName = await vault.name();
    const currencyToken = await vault.currencyToken();
    const currencyTokenSymbol = await (await ethers.getContractAt("IERC20Metadata", currencyToken)).symbol();
    console.log(
      `${vaultAddress} | ${vaultName.padEnd(16)} | Currency Token: ${currencyToken} (${currencyTokenSymbol})`
    );
  }
}

async function registryRegister(deployment: Deployment, vaultAddress: string) {
  if (!deployment.vaultRegistry) {
    console.error("Vault registry not yet deployed.");
    return;
  }

  const vaultRegistry = (await ethers.getContractAt(
    "IVaultRegistry",
    deployment.vaultRegistry,
    signer
  )) as VaultRegistry;
  await vaultRegistry.registerVault(vaultAddress);
}

async function registryUnregister(deployment: Deployment, vaultAddress: string) {
  if (!deployment.vaultRegistry) {
    console.error("Vault registry not yet deployed.");
    return;
  }

  const vaultRegistry = (await ethers.getContractAt(
    "IVaultRegistry",
    deployment.vaultRegistry,
    signer
  )) as VaultRegistry;
  await vaultRegistry.unregisterVault(vaultAddress);
}

/******************************************************************************/
/* Vault Functions */
/******************************************************************************/

async function vaultDeploy(
  deployment: Deployment,
  name: string,
  collateralOracle: string,
  seniorLPSymbol: string,
  juniorLPSymbol: string
) {
  if (!deployment.lpTokenBeacon || !deployment.vaultBeacon) {
    console.error("Beacons not yet deployed.");
    return;
  } else if (!deployment.vaultRegistry) {
    console.error("Vault registry not yet deployed.");
    return;
  }

  const loanPriceOracleFactory = await ethers.getContractFactory("LoanPriceOracle", signer);
  const lpTokenFactory = await ethers.getContractFactory("LPToken", signer);
  const vaultFactory = await ethers.getContractFactory("Vault", signer);

  const currencyToken = await (await ethers.getContractAt("ICollateralOracle", collateralOracle)).currencyToken();

  const loanPriceOracle = await loanPriceOracleFactory.deploy(collateralOracle);
  await loanPriceOracle.deployed();
  console.debug(`Loan Price Oracle: ${loanPriceOracle.address}`);

  const seniorLPToken = await upgrades.deployBeaconProxy(deployment.lpTokenBeacon, lpTokenFactory, [
    "MetaStreet Senior LP " + name,
    seniorLPSymbol,
  ]);
  await seniorLPToken.deployed();
  console.debug(`Senior LP Token:   ${seniorLPToken.address}`);

  const juniorLPToken = await upgrades.deployBeaconProxy(deployment.lpTokenBeacon, lpTokenFactory, [
    "MetaStreet Junior LP " + name,
    juniorLPSymbol,
  ]);
  await juniorLPToken.deployed();
  console.debug(`Junior LP Token:   ${juniorLPToken.address}`);
  console.debug();

  const vaultAddress = getContractAddress({
    from: await signer!.getAddress(),
    nonce: (await signer!.getTransactionCount()) + 1,
  });
  const vaultRegistry = (await ethers.getContractAt(
    "VaultRegistry",
    deployment.vaultRegistry,
    signer
  )) as VaultRegistry;
  await vaultRegistry.registerVault(vaultAddress);

  const vault = await upgrades.deployBeaconProxy(deployment.vaultBeacon, vaultFactory, [
    name,
    currencyToken,
    loanPriceOracle.address,
    seniorLPToken.address,
    juniorLPToken.address,
  ]);
  await vault.deployed();

  await seniorLPToken.transferOwnership(vault.address);
  await juniorLPToken.transferOwnership(vault.address);

  console.log(vault.address);
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
  const adminFeeRate = await vault.adminFeeRate();
  const supportedNoteTokens = await vault.supportedNoteTokens();

  console.log("Vault");
  console.log(`  Name:                ${vaultName}`);
  console.log(`  Impl. Version:       ${implVersion}`);
  console.log(`  Currency Token:      ${currencyToken} (${currencyTokenSymbol})`);
  console.log(`  Senior LP Token:     ${seniorLPToken} (${seniorLPTokenSymbol})`);
  console.log(`  Junior LP Token:     ${juniorLPToken} (${juniorLPTokenSymbol})`);
  console.log(`  Senior Tranche Rate: ${ethers.utils.formatEther(seniorTrancheRate.mul(100))}%`);
  console.log(`  Admin Fee Rate:      ${ethers.utils.formatEther(adminFeeRate.mul(100))}%`);
  if (supportedNoteTokens) {
    console.log(`  Note Tokens:`);
    for (const noteToken of supportedNoteTokens) {
      const noteTokenName = await (await ethers.getContractAt("IERC20Metadata", noteToken)).name();
      const noteAdapter = await vault.noteAdapters(noteToken);
      const noteAdapterName = await (await ethers.getContractAt("INoteAdapter", noteAdapter)).name();
      console.log(`    Note Token:   ${noteToken} (${noteTokenName})`);
      console.log(`    Note Adapter: ${noteAdapter} (${noteAdapterName})`);
      console.log();
    }
  }
}

async function vaultSetNoteAdapter(vaultAddress: string, noteAdapter: string) {
  const noteToken = await (await ethers.getContractAt("INoteAdapter", noteAdapter)).noteToken();

  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.setNoteAdapter(noteToken, noteAdapter);
}

async function vaultDisableNoteAdapter(vaultAddress: string, noteAdapter: string) {
  const noteToken = await (await ethers.getContractAt("INoteAdapter", noteAdapter)).noteToken();

  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.setNoteAdapter(noteToken, ethers.constants.AddressZero);
}

async function vaultSetLoanPriceOracle(vaultAddress: string, loanPriceOracle: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.setLoanPriceOracle(loanPriceOracle);
}

async function vaultSetSeniorTrancheRate(vaultAddress: string, rate: BigNumber) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.setSeniorTrancheRate(rate.div(365 * 86400));
}

async function vaultSetAdminFeeRate(vaultAddress: string, rate: BigNumber) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.setAdminFeeRate(rate);
}

async function vaultSetNoteSellerApproval(vaultAddress: string, enabled: boolean) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.setNoteSellerApproval(enabled);
}

async function vaultAddNoteSeller(vaultAddress: string, seller: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.grantRole(await vault.NOTE_SELLER_ROLE(), seller);
}

async function vaultRemoveNoteSeller(vaultAddress: string, seller: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.revokeRole(await vault.NOTE_SELLER_ROLE(), seller);
}

async function vaultAddCollateralLiquidator(vaultAddress: string, liquidator: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.grantRole(await vault.COLLATERAL_LIQUIDATOR_ROLE(), liquidator);
}

async function vaultRemoveCollateralLiquidator(vaultAddress: string, liquidator: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.revokeRole(await vault.COLLATERAL_LIQUIDATOR_ROLE(), liquidator);
}

async function vaultAddEmergencyAdmin(vaultAddress: string, emergencyAdmin: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.grantRole(await vault.EMERGENCY_ADMIN_ROLE(), emergencyAdmin);
}

async function vaultRemoveEmergencyAdmin(vaultAddress: string, emergencyAdmin: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.revokeRole(await vault.EMERGENCY_ADMIN_ROLE(), emergencyAdmin);
}

async function vaultServiceLoans(vaultAddress: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;

  while (true) {
    const [upkeepNeeded, performData] = await vault.checkUpkeep("0x");
    if (!upkeepNeeded) {
      break;
    }

    console.log(`Calling performUpkeep() with data ${performData}...`);
    const performUpkeepTx = await vault.performUpkeep(performData);
    console.log(performUpkeepTx.hash);
    await performUpkeepTx.wait();
    console.log();
  }

  console.log("All loans serviced.");
}

async function vaultPause(vaultAddress: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.pause();
}

async function vaultUnpause(vaultAddress: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress, signer)) as Vault;
  await vault.unpause();
}

/******************************************************************************/
/* Loan Price Oracle Helper Functions for Parameters */
/******************************************************************************/

type SerializedPiecewiseLinearModel = {
  minRate: string;
  targetRate: string;
  maxRate: string;
  target: string;
  max: string;
};

type SerializedCollateralParameters = {
  active: boolean;
  loanToValueRateComponent: SerializedPiecewiseLinearModel;
  durationRateComponent: SerializedPiecewiseLinearModel;
  rateComponentWeights: [number, number, number];
};

type SerializedUtilizationParameters = SerializedPiecewiseLinearModel;

function deserializePiecewiseLinearModel(serialized: SerializedPiecewiseLinearModel): PiecewiseLinearModel {
  return computePiecewiseLinearModel({
    minRate: FixedPoint.normalizeRate(serialized.minRate),
    targetRate: FixedPoint.normalizeRate(serialized.targetRate),
    maxRate: FixedPoint.normalizeRate(serialized.maxRate),
    target: FixedPoint.from(serialized.target),
    max: FixedPoint.from(serialized.max),
  });
}

function deserializeUtilizationParameters(serialized: SerializedUtilizationParameters): UtilizationParameters {
  return deserializePiecewiseLinearModel(serialized);
}

function deserializeCollateralParameters(serialized: SerializedCollateralParameters): CollateralParameters {
  return {
    active: serialized.active,
    loanToValueRateComponent: deserializePiecewiseLinearModel(serialized.loanToValueRateComponent),
    durationRateComponent: deserializePiecewiseLinearModel(serialized.durationRateComponent),
    rateComponentWeights: serialized.rateComponentWeights,
  };
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
  const collateralOracle = await loanPriceOracle.collateralOracle();
  const currencyToken = await loanPriceOracle.currencyToken();
  const currencyTokenSymbol = await (await ethers.getContractAt("IERC20Metadata", currencyToken)).symbol();
  const minimumLoanDuration = await loanPriceOracle.minimumLoanDuration();

  console.log("LoanPriceOracle");
  console.log(`  Address:            ${loanPriceOracle.address}`);
  console.log(`  Impl. Version:      ${implVersion}`);
  console.log(`  Collateral Oracle:  ${collateralOracle}`);
  console.log(`  Currency Token:     ${currencyToken} (${currencyTokenSymbol})`);
  console.log(`  Min. Loan Duration: ${minimumLoanDuration.div(86400)} days (${minimumLoanDuration} seconds)`);
}

async function vaultLpoSetMinimumLoanDuration(vaultAddress: string, duration: number) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle(),
    signer
  )) as LoanPriceOracle;
  await loanPriceOracle.setMinimumLoanDuration(duration);
}

async function vaultLpoSetUtilizationParameters(vaultAddress: string, path: string) {
  const serialized: SerializedUtilizationParameters = JSON.parse(fs.readFileSync(path, "utf-8"));
  const utilizationParameters = deserializeUtilizationParameters(serialized);

  console.log("Utilization Parameters:");
  console.log(utilizationParameters);

  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle(),
    signer
  )) as LoanPriceOracle;
  await loanPriceOracle.setUtilizationParameters(encodeUtilizationParameters(utilizationParameters));
}

async function vaultLpoSetCollateralParameters(vaultAddress: string, token: string, path: string) {
  const serialized: SerializedCollateralParameters = JSON.parse(fs.readFileSync(path, "utf-8"));
  const collateralParameters = deserializeCollateralParameters(serialized);

  console.log("Collateral Parameters:");
  console.log(collateralParameters);

  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle(),
    signer
  )) as LoanPriceOracle;
  await loanPriceOracle.setCollateralParameters(token, encodeCollateralParameters(collateralParameters));
}

async function vaultLpoSetCollateralOracle(vaultAddress: string, collateralOracle: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle(),
    signer
  )) as LoanPriceOracle;
  await loanPriceOracle.setCollateralOracle(collateralOracle);
}

async function vaultLpoAddParameterAdmin(vaultAddress: string, parameterAdmin: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle(),
    signer
  )) as LoanPriceOracle;
  await loanPriceOracle.grantRole(await loanPriceOracle.PARAMETER_ADMIN_ROLE(), parameterAdmin);
}

async function vaultLpoRemoveParameterAdmin(vaultAddress: string, parameterAdmin: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle(),
    signer
  )) as LoanPriceOracle;
  await loanPriceOracle.revokeRole(await loanPriceOracle.PARAMETER_ADMIN_ROLE(), parameterAdmin);
}

async function vaultLpoCoSetCollateralValue(vaultAddress: string, collateralToken: string, collateralValue: BigNumber) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle()
  )) as LoanPriceOracle;
  const staticCollateralOracle = (await ethers.getContractAt(
    "StaticCollateralOracle",
    await loanPriceOracle.collateralOracle(),
    signer
  )) as StaticCollateralOracle;
  await staticCollateralOracle.setCollateralValue(collateralToken, collateralValue);
}

async function vaultLpoCoAddParameterAdmin(vaultAddress: string, parameterAdmin: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle()
  )) as LoanPriceOracle;
  const staticCollateralOracle = (await ethers.getContractAt(
    "StaticCollateralOracle",
    await loanPriceOracle.collateralOracle(),
    signer
  )) as StaticCollateralOracle;
  await staticCollateralOracle.grantRole(await staticCollateralOracle.PARAMETER_ADMIN_ROLE(), parameterAdmin);
}

async function vaultLpoCoRemoveParameterAdmin(vaultAddress: string, parameterAdmin: string) {
  const vault = (await ethers.getContractAt("Vault", vaultAddress)) as Vault;
  const loanPriceOracle = (await ethers.getContractAt(
    "LoanPriceOracle",
    await vault.loanPriceOracle()
  )) as LoanPriceOracle;
  const staticCollateralOracle = (await ethers.getContractAt(
    "StaticCollateralOracle",
    await loanPriceOracle.collateralOracle(),
    signer
  )) as StaticCollateralOracle;
  await staticCollateralOracle.revokeRole(await staticCollateralOracle.PARAMETER_ADMIN_ROLE(), parameterAdmin);
}

async function vaultLpoPriceLoan(vaultAddress: string, noteToken: string, noteTokenId: BigNumber) {
  const vault = (await ethers.getContractAt("IVault", vaultAddress)) as IVault;
  const noteAdapter = (await ethers.getContractAt("INoteAdapter", await vault.noteAdapters(noteToken))) as INoteAdapter;
  const loanPriceOracle = (await ethers.getContractAt(
    "ILoanPriceOracle",
    await vault.loanPriceOracle()
  )) as ILoanPriceOracle;

  const loanInfo = await noteAdapter.getLoanInfo(noteTokenId);
  const utilization = await vault["utilization()"]();

  console.log(`Collateral Token:    ${loanInfo.collateralToken}`);
  console.log(`Collateral Token ID: ${loanInfo.collateralTokenId.toString()}`);
  console.log(`Principal:           ${ethers.utils.formatEther(loanInfo.principal)}`);
  console.log(`Repayment:           ${ethers.utils.formatEther(loanInfo.repayment)}`);
  console.log(
    `Duration:            ${loanInfo.duration.div(86400).toNumber()} days (${loanInfo.duration.toNumber()} seconds)`
  );
  console.log(`Maturity:            ${new Date(loanInfo.maturity.toNumber() * 1000).toString()}`);
  console.log("");
  console.log(`Vault Utilization:   ${ethers.utils.formatEther(utilization)}`);
  console.log("");

  const price = await loanPriceOracle.priceLoan(
    loanInfo.collateralToken,
    loanInfo.collateralTokenId,
    loanInfo.principal,
    loanInfo.repayment,
    loanInfo.duration,
    loanInfo.maturity,
    utilization
  );
  console.log(`Loan Price:          ${ethers.utils.formatEther(price)}`);
}

async function vaultLpoPriceLoanRepayment(
  vaultAddress: string,
  token: string,
  tokenId: BigNumber,
  principal: BigNumber,
  duration: number
) {
  const vault = (await ethers.getContractAt("IVault", vaultAddress)) as IVault;
  const loanPriceOracle = (await ethers.getContractAt(
    "ILoanPriceOracle",
    await vault.loanPriceOracle()
  )) as ILoanPriceOracle;

  const utilization = await vault["utilization()"]();

  const repayment = await loanPriceOracle.priceLoanRepayment(token, tokenId, principal, duration, utilization);
  console.log(`Repayment:  ${ethers.utils.formatEther(repayment)}`);
}

/******************************************************************************/
/* Note Adapter Functions */
/******************************************************************************/

async function noteAdapterDeploy(contractName: string, ...args: string[]) {
  const noteAdapterFactory = await ethers.getContractFactory(contractName, signer);

  const noteAdapter = await noteAdapterFactory.deploy(...args[0]);
  await noteAdapter.deployed();

  console.log(noteAdapter.address);
}

async function noteAdapterInfo(noteAdapterAddress: string) {
  const noteAdapter = (await ethers.getContractAt("INoteAdapter", noteAdapterAddress)) as INoteAdapter;

  const implVersion = await (
    await ethers.getContractAt(["function IMPLEMENTATION_VERSION() view returns (string)"], noteAdapterAddress)
  ).IMPLEMENTATION_VERSION();
  const name = await noteAdapter.name();
  const noteToken = await noteAdapter.noteToken();
  const noteTokenName = await (await ethers.getContractAt("IERC20Metadata", noteToken)).name();

  console.log("Note Adapter");
  console.log(`  Name:          ${name}`);
  console.log(`  Impl. Version: ${implVersion}`);
  console.log(`  Note Token:    ${noteToken} (${noteTokenName})`);
}

/******************************************************************************/
/* Collateral Oracle Deployment */
/******************************************************************************/

async function collateralOracleDeploy(currencyToken: string) {
  const staticCollateralOracleFactory = await ethers.getContractFactory("StaticCollateralOracle", signer);

  const staticCollateralOracle = await staticCollateralOracleFactory.deploy(currencyToken);
  await staticCollateralOracle.deployed();

  console.log(staticCollateralOracle.address);
}

/******************************************************************************/
/* Loan Price Oracle Deployment */
/******************************************************************************/

async function loanPriceOracleDeploy(collateralOracle: string) {
  const loanPriceOracleFactory = await ethers.getContractFactory("LoanPriceOracle", signer);

  const loanPriceOracle = await loanPriceOracleFactory.deploy(collateralOracle);
  await loanPriceOracle.deployed();

  console.log(loanPriceOracle.address);
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

function parseBigNumber(value: string, _: string): BigNumber {
  try {
    return ethers.BigNumber.from(value);
  } catch (e) {
    throw new InvalidArgumentError("Invalid number: " + e);
  }
}

/******************************************************************************/
/* Entry Point */
/******************************************************************************/

async function main() {
  /* Load deployment */
  const network = await ethers.provider.getNetwork();
  const deploymentPath: string = process.env.DEPLOYMENT_PATH || `deployments/${network.name}-${network.chainId}.json`;
  const deployment: Deployment = fs.existsSync(deploymentPath)
    ? Deployment.fromFile(deploymentPath)
    : Deployment.fromScratch(network);

  /* Load signer */
  if (signer === undefined) {
    if (process.env.LEDGER_DERIVATION_PATH) {
      signer = new LedgerSigner(ethers.provider, process.env.LEDGER_DERIVATION_PATH);
    } else {
      signer = (await ethers.getSigners())[0];
    }
  }

  /* Program Commands */
  const program = new Command();

  program.name("deployment-manager").description("CLI for Vault deployment").version("0.1.0");

  program
    .command("show")
    .description("Show current deployment")
    .action(() => deployment.dump());
  program
    .command("show-address")
    .description("Show address of signer")
    .action(async () => console.log(await signer!.getAddress()));

  program
    .command("beacon-deploy")
    .description("Deploy beacons")
    .action(() => beaconDeploy(deployment));
  program
    .command("beacon-show")
    .description("Show beacons")
    .action(() => beaconShow(deployment));
  program
    .command("beacon-upgrade-vault")
    .description("Upgrade beacon implementation for Vault")
    .action(() => beaconUpgradeVault(deployment));
  program
    .command("beacon-upgrade-lptoken")
    .description("Upgrade beacon implementation for LPToken")
    .action(() => beaconUpgradeLPToken(deployment));

  program
    .command("registry-deploy")
    .description("Deploy Vault registry")
    .action(() => registryDeploy(deployment));
  program
    .command("registry-list")
    .description("List deployed Vaults")
    .action(() => registryList(deployment));
  program
    .command("registry-register")
    .description("Register Vault")
    .argument("vault", "Vault address", parseAddress)
    .action((vaultAddress) => registryRegister(deployment, vaultAddress));
  program
    .command("registry-unregister")
    .description("Unregister Vault")
    .argument("vault", "Vault address", parseAddress)
    .action((vaultAddress) => registryUnregister(deployment, vaultAddress));

  program
    .command("vault-deploy")
    .description("Deploy Vault")
    .argument("name", "Name of Vault")
    .argument("collateral_oracle", "Collateral oracle address", parseAddress)
    .argument("senior_lp_symbol", "Senior LPToken symbol")
    .argument("junior_lp_symbol", "Junior LPToken symbol")
    .action((name, collateralOracle, seniorLPSymbol, juniorLPSymbol) =>
      vaultDeploy(deployment, name, collateralOracle, seniorLPSymbol, juniorLPSymbol)
    );
  program
    .command("vault-info")
    .description("Dump Vault information")
    .argument("vault", "Vault address", parseAddress)
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
    .argument("note_adapter", "Note adapter address", parseAddress)
    .action(vaultSetNoteAdapter);
  program
    .command("vault-disable-note-adapter")
    .description("Disable Vault note adapter")
    .argument("vault", "Vault address", parseAddress)
    .argument("note_adapter", "Note adapter address", parseAddress)
    .action(vaultDisableNoteAdapter);
  program
    .command("vault-set-loan-price-oracle")
    .description("Set Vault Loan Price Oracle")
    .argument("vault", "Vault address", parseAddress)
    .argument("loan_price_oracle", "Loan Price Oracle address", parseAddress)
    .action(vaultSetLoanPriceOracle);

  program
    .command("vault-set-note-seller-approval")
    .description("Set note seller approval")
    .argument("vault", "Vault address", parseAddress)
    .argument("enabled", "Note seller approval enabled", (x, _) => x === "true")
    .action(vaultSetNoteSellerApproval);
  program
    .command("vault-add-note-seller")
    .description("Add Vault note seller")
    .argument("vault", "Vault address", parseAddress)
    .argument("seller", "Note seller address", parseAddress)
    .action(vaultAddNoteSeller);
  program
    .command("vault-remove-note-seller")
    .description("Remove Vault note seller")
    .argument("vault", "Vault address", parseAddress)
    .argument("seller", "Note seller address", parseAddress)
    .action(vaultRemoveNoteSeller);

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
    .command("vault-add-emergency-admin")
    .description("Add Vault emergency admin")
    .argument("vault", "Vault address", parseAddress)
    .argument("emergency_admin", "Emergency admin address", parseAddress)
    .action(vaultAddEmergencyAdmin);
  program
    .command("vault-remove-emergency-admin")
    .description("Remove Vault emergency admin")
    .argument("vault", "Vault address", parseAddress)
    .argument("emergency_admin", "Emergency admin address", parseAddress)
    .action(vaultRemoveEmergencyAdmin);

  program
    .command("vault-service-loans")
    .description("Service Vault loans")
    .argument("vault", "Vault address", parseAddress)
    .action(vaultServiceLoans);
  program
    .command("vault-pause")
    .description("Pause Vault")
    .argument("vault", "Vault address", parseAddress)
    .action(vaultPause);
  program
    .command("vault-unpause")
    .description("Unpause Vault")
    .argument("vault", "Vault address", parseAddress)
    .action(vaultUnpause);

  program
    .command("vault-lpo-info")
    .description("Dump Vault Loan Price Oracle information")
    .argument("vault", "Vault address", parseAddress)
    .action(vaultLpoInfo);
  program
    .command("vault-lpo-set-minimum-loan-duration")
    .description("Set Vault Loan Price Oracle minimum loan duration")
    .argument("vault", "Vault address", parseAddress)
    .argument("duration", "Minimum loan duration (in seconds)", parseNumber)
    .action(vaultLpoSetMinimumLoanDuration);
  program
    .command("vault-lpo-set-utilization-parameters")
    .description("Set Vault Loan Price Oracle utilization parameters")
    .argument("vault", "Vault address", parseAddress)
    .argument("path", "Path to JSON parameters")
    .action(vaultLpoSetUtilizationParameters);
  program
    .command("vault-lpo-set-collateral-parameters")
    .description("Set Vault Loan Price Oracle collateral parameters")
    .argument("vault", "Vault address", parseAddress)
    .argument("token", "Collateral token address", parseAddress)
    .argument("path", "Path to JSON parameters")
    .action(vaultLpoSetCollateralParameters);
  program
    .command("vault-lpo-set-collateral-oracle")
    .description("Set Vault Loan Price Oracle collateral oracle")
    .argument("vault", "Vault address", parseAddress)
    .argument("collateral_oracle", "Collateral oracle address", parseAddress)
    .action(vaultLpoSetCollateralOracle);
  program
    .command("vault-lpo-add-parameter-admin")
    .description("Add Vault Loan Price Oracle parameter admin")
    .argument("vault", "Vault address", parseAddress)
    .argument("parameter_admin", "Parameter admin address", parseAddress)
    .action(vaultLpoAddParameterAdmin);
  program
    .command("vault-lpo-remove-parameter-admin")
    .description("Remove Vault Loan Price Oracle parameter admin")
    .argument("vault", "Vault address", parseAddress)
    .argument("parameter_admin", "Parameter admin address", parseAddress)
    .action(vaultLpoRemoveParameterAdmin);
  program
    .command("vault-lpo-co-set-collateral-value")
    .description("Set Collateral Oracle collateral value")
    .argument("vault", "Vault address", parseAddress)
    .argument("token", "Collateral token address", parseAddress)
    .argument("value", "Collateral value", parseDecimal)
    .action(vaultLpoCoSetCollateralValue);
  program
    .command("vault-lpo-co-add-parameter-admin")
    .description("Add Vault Collateral Oracle parameter admin")
    .argument("vault", "Vault address", parseAddress)
    .argument("parameter_admin", "Parameter admin address", parseAddress)
    .action(vaultLpoCoAddParameterAdmin);
  program
    .command("vault-lpo-co-remove-parameter-admin")
    .description("Remove Vault Collateral Oracle parameter admin")
    .argument("vault", "Vault address", parseAddress)
    .argument("parameter_admin", "Parameter admin address", parseAddress)
    .action(vaultLpoCoRemoveParameterAdmin);

  program
    .command("vault-lpo-price-loan")
    .description("Use the Vault Loan Price Oracle to price a loan")
    .argument("vault", "Vault address", parseAddress)
    .argument("token", "Note token address", parseAddress)
    .argument("token_id", "Note token ID", parseBigNumber)
    .action(vaultLpoPriceLoan);
  program
    .command("vault-lpo-price-loan-repayment")
    .description("Use the Vault Loan Price Oracle to price a loan repayment")
    .argument("vault", "Vault address", parseAddress)
    .argument("token", "Token address", parseAddress)
    .argument("token_id", "Token ID", parseBigNumber)
    .argument("principal", "Principal", parseDecimal)
    .argument("duration", "duration", parseNumber)
    .action(vaultLpoPriceLoanRepayment);

  program
    .command("note-adapter-deploy")
    .description("Deploy Note Adapter")
    .argument("contract", "Note adapter contract name")
    .argument("args...", "Arguments")
    .action(noteAdapterDeploy);
  program
    .command("note-adapter-info")
    .description("Dump Note Adapter information")
    .argument("note_adapter", "Note adapter address", parseAddress)
    .action(noteAdapterInfo);

  program
    .command("co-deploy")
    .description("Deploy Collateral Oracle")
    .argument("currency_token", "Currency token address", parseAddress)
    .action(collateralOracleDeploy);

  program
    .command("lpo-deploy")
    .description("Deploy Loan Price Oracle")
    .argument("collateral_oracle", "Collateral oracle address", parseAddress)
    .action(loanPriceOracleDeploy);

  /* Parse command */
  await program.parseAsync(process.argv);

  /* Save deployment */
  deployment.toFile(deploymentPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
