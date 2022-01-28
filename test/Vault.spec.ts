import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { TestERC20, TestERC721, TestLendingPlatform, TestNoteToken } from "../typechain";
import { Vault } from "../typechain";
import { IERC20Metadata } from "../typechain";

import { extractEvent, expectEvent } from "./helpers/EventUtilities";

describe("Vault", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let nft1: TestERC721;
  let lendingPlatform: TestLendingPlatform;
  let noteToken: TestNoteToken;
  let vault: Vault;
  let seniorLPToken: IERC20Metadata;
  let juniorLPToken: IERC20Metadata;

  beforeEach("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const testERC721Factory = await ethers.getContractFactory("TestERC721");
    const testLendingPlatformFactory = await ethers.getContractFactory("TestLendingPlatform");
    const testNoteTokenFactory = await ethers.getContractFactory("TestNoteToken");
    const vaultFactory = await ethers.getContractFactory("Vault");

    tok1 = (await testERC20Factory.deploy("Token 1", "TOK1", ethers.utils.parseEther("1000"))) as TestERC20;
    await tok1.deployed();

    nft1 = (await testERC721Factory.deploy("NFT 1", "NFT1", "https://nft1.com/token/")) as TestERC721;
    await nft1.deployed();

    lendingPlatform = (await testLendingPlatformFactory.deploy(tok1.address)) as TestLendingPlatform;
    await lendingPlatform.deployed();

    noteToken = (await ethers.getContractAt(
      "TestNoteToken",
      await lendingPlatform.noteToken(),
      accounts[0]
    )) as TestNoteToken;

    vault = (await vaultFactory.deploy("Test Vault", "TEST", tok1.address, ethers.constants.AddressZero)) as Vault;
    await vault.deployed();

    seniorLPToken = (await ethers.getContractAt("IERC20Metadata", await vault.lpToken(0))) as IERC20Metadata;
    juniorLPToken = (await ethers.getContractAt("IERC20Metadata", await vault.lpToken(1))) as IERC20Metadata;
  });

  it("initial properties", async function () {});

  it("tranche states initialized", async function () {});

  it("deposit senior", async function () {});

  it("deposit junior", async function () {});

  it("deposit multiple", async function () {});

  it("sell note", async function () {});

  it("sell note and deposit", async function () {});

  it("sell note and deposit batch", async function () {});

  it("share price proration", async function () {});

  it("loan repayment", async function () {});

  it("loan default", async function () {});

  it("single redemption", async function () {});

  it("multiple redemptions", async function () {});

  it("withdraw", async function () {});
});
