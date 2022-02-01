import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { TestERC20, TestERC721, LoanPriceOracle } from "../typechain";

import { extractEvent, expectEvent } from "./helpers/EventUtilities";

describe("LoanPriceOracle", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let nft1: TestERC721;
  let loanPriceOracle: LoanPriceOracle;

  beforeEach("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const testERC721Factory = await ethers.getContractFactory("TestERC721");
    const loanPriceOracleFactory = await ethers.getContractFactory("LoanPriceOracle");

    tok1 = (await testERC20Factory.deploy("Token 1", "TOK1", ethers.utils.parseEther("1000"))) as TestERC20;
    await tok1.deployed();

    nft1 = (await testERC721Factory.deploy("NFT 1", "NFT1", "https://nft1.com/token/")) as TestERC721;
    await nft1.deployed();

    loanPriceOracle = (await loanPriceOracleFactory.deploy(tok1.address)) as LoanPriceOracle;
    await loanPriceOracle.deployed();
  });

  describe("#priceLoan", async function () {
    it("prices 15/30 day loan successfully", async function () {});
    it("prices 45/60 day loan successfully", async function () {});
    it("prices 85/90 day loan successfully", async function () {});
    it("fails on insufficient time remaining", async function () {});
    it("fails on unsupported token contract", async function () {});
    it("fails on unsupported duration", async function () {});
    it("fails on purchase price out of bounds", async function () {});
  });

  describe("#setTokenParameters", async function () {
    it("sets token parameters successfully", async function () {});
    it("replaces token parameters successfully", async function () {});
    it("fails on invalid caller", async function () {});
  });
});
