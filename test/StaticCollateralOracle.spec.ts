import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { TestERC20, TestERC721, StaticCollateralOracle } from "../typechain";

import { expectEvent } from "./helpers/EventUtilities";

describe("StaticCollateralOracle", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let nft1: TestERC721;
  let staticCollateralOracle: StaticCollateralOracle;
  let snapshotId: string;

  before("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const testERC721Factory = await ethers.getContractFactory("TestERC721");
    const staticCollateralOracleFactory = await ethers.getContractFactory("StaticCollateralOracle");

    tok1 = (await testERC20Factory.deploy("WETH", "WETH", 18, ethers.utils.parseEther("1000"))) as TestERC20;
    await tok1.deployed();

    nft1 = (await testERC721Factory.deploy("NFT 1", "NFT1", "https://nft1.com/token/")) as TestERC721;
    await nft1.deployed();

    staticCollateralOracle = (await staticCollateralOracleFactory.deploy(tok1.address)) as StaticCollateralOracle;
    await staticCollateralOracle.deployed();
  });

  beforeEach("snapshot blockchain", async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);
  });

  afterEach("restore blockchain snapshot", async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  describe("constants", async function () {
    it("matches implementation version", async function () {
      expect(await staticCollateralOracle.IMPLEMENTATION_VERSION()).to.equal(ethers.utils.hexlify(ethers.utils.toUtf8Bytes("1.0")));
    });
  });

  describe("getters", async function () {
    it("currency token matches constructor", async function () {
      expect(await staticCollateralOracle.currencyToken()).to.equal(tok1.address);
    });
    it("roles are correct", async function () {
      expect(
        await staticCollateralOracle.hasRole(await staticCollateralOracle.DEFAULT_ADMIN_ROLE(), accounts[0].address)
      ).to.equal(true);
      expect(
        await staticCollateralOracle.hasRole(await staticCollateralOracle.PARAMETER_ADMIN_ROLE(), accounts[0].address)
      ).to.equal(true);
    });
  });

  describe("#collateralValue", async function () {
    it("returns correct collateral value", async function () {
      await staticCollateralOracle.setCollateralValue(nft1.address, ethers.utils.parseEther("123"));

      expect(await staticCollateralOracle.collateralValue(nft1.address, 10)).to.equal(ethers.utils.parseEther("123"));
      expect(await staticCollateralOracle.collateralValue(nft1.address, 42)).to.equal(ethers.utils.parseEther("123"));
    });
    it("fails on unsupported collateral", async function () {
      await expect(staticCollateralOracle.collateralValue(tok1.address, 1)).to.be.revertedWith(
        "UnsupportedCollateral()"
      );
    });
  });

  describe("#setCollateralValue", async function () {
    it("sets collateral value successfully", async function () {
      const setCollateralValueTx = await staticCollateralOracle.setCollateralValue(
        nft1.address,
        ethers.utils.parseEther("123")
      );
      await expectEvent(setCollateralValueTx, staticCollateralOracle, "CollateralValueUpdated", {
        collateralToken: nft1.address,
        collateralValue: ethers.utils.parseEther("123"),
      });

      expect(await staticCollateralOracle.collateralValue(nft1.address, 0)).to.equal(ethers.utils.parseEther("123"));
    });
    it("fails on invalid address", async function () {
      await expect(
        staticCollateralOracle.setCollateralValue(ethers.constants.AddressZero, ethers.utils.parseEther("123"))
      ).to.be.revertedWith("InvalidAddress()");
    });
    it("fails on invalid caller", async function () {
      await expect(
        staticCollateralOracle.connect(accounts[1]).setCollateralValue(nft1.address, ethers.utils.parseEther("123"))
      ).to.be.revertedWith("AccessControl: account");

      await staticCollateralOracle.revokeRole(await staticCollateralOracle.PARAMETER_ADMIN_ROLE(), accounts[0].address);
      await expect(
        staticCollateralOracle.setCollateralValue(nft1.address, ethers.utils.parseEther("123"))
      ).to.be.revertedWith("AccessControl: account");
    });
  });
});
