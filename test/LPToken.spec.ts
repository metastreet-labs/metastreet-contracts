import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { TestERC20, TestERC721, TestLendingPlatform, TestNoteToken } from "../typechain";
import { Vault } from "../typechain";
import { IERC20Metadata } from "../typechain";

import { extractEvent, expectEvent } from "./helpers/EventUtilities";

describe("LPToken", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let vault: Vault;
  let seniorLPToken: IERC20Metadata;
  let juniorLPToken: IERC20Metadata;

  beforeEach("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const vaultFactory = await ethers.getContractFactory("Vault");

    tok1 = (await testERC20Factory.deploy("Token 1", "TOK1", ethers.utils.parseEther("1000"))) as TestERC20;
    await tok1.deployed();

    vault = (await vaultFactory.deploy("Test Vault", "TEST", tok1.address, ethers.constants.AddressZero)) as Vault;
    await vault.deployed();

    seniorLPToken = (await ethers.getContractAt("IERC20Metadata", await vault.lpToken(0))) as IERC20Metadata;
    juniorLPToken = (await ethers.getContractAt("IERC20Metadata", await vault.lpToken(1))) as IERC20Metadata;
  });

  describe("#mint", async function () {
    it("fails on invalid caller", async function () {});
  });

  describe("#redeem", async function () {
    it("fails on invalid caller", async function () {});
  });

  describe("#withdraw", async function () {
    it("fails on invalid caller", async function () {});
  });
});
