import { expect } from "chai";
import { ethers } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { TestERC20, TestERC721, LoanPriceOracle } from "../typechain";

import { expectEvent } from "./helpers/EventUtilities";
import { TokenParameters, encodeTokenParameters, normalizeRate } from "./helpers/LoanPriceOracleHelpers";

describe("LoanPriceOracle", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let nft1: TestERC721;
  let loanPriceOracle: LoanPriceOracle;
  let lastBlockTimestamp: number;

  beforeEach("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const testERC721Factory = await ethers.getContractFactory("TestERC721");
    const loanPriceOracleFactory = await ethers.getContractFactory("LoanPriceOracle");

    tok1 = (await testERC20Factory.deploy("WETH", "WETH", ethers.utils.parseEther("1000"))) as TestERC20;
    await tok1.deployed();

    nft1 = (await testERC721Factory.deploy("NFT 1", "NFT1", "https://nft1.com/token/")) as TestERC721;
    await nft1.deployed();

    loanPriceOracle = (await loanPriceOracleFactory.deploy(tok1.address)) as LoanPriceOracle;
    await loanPriceOracle.deployed();

    lastBlockTimestamp = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;
  });

  const tokenParameters: TokenParameters[] = [
    {
      duration: 30 * 86400,
      minDiscountRate: normalizeRate("0.25"),
      aprSensitivity: normalizeRate("0.00010"),
      minPurchasePrice: ethers.utils.parseEther("100"),
      maxPurchasePrice: ethers.utils.parseEther("1000"),
    },
    {
      duration: 60 * 86400,
      minDiscountRate: normalizeRate("0.35"),
      aprSensitivity: normalizeRate("0.00025"),
      minPurchasePrice: ethers.utils.parseEther("100"),
      maxPurchasePrice: ethers.utils.parseEther("1000"),
    },
    {
      duration: 90 * 86400,
      minDiscountRate: normalizeRate("0.60"),
      aprSensitivity: normalizeRate("0.00050"),
      minPurchasePrice: ethers.utils.parseEther("100"),
      maxPurchasePrice: ethers.utils.parseEther("1000"),
    },
  ];

  describe("#priceLoan", async function () {
    beforeEach("setup token parameters", async () => {
      await loanPriceOracle.setTokenParameters(nft1.address, encodeTokenParameters(tokenParameters));
    });

    it("prices 0/30 day loan successfully", async function () {
      const principal = ethers.utils.parseEther("200");
      const repayment = ethers.utils.parseEther("220");
      const duration = 30 * 86400;
      const maturity = lastBlockTimestamp + duration;

      expect(await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity)).to.equal(
        ethers.utils.parseEther("215.171583856609272759")
      );
    });
    it("prices 15/30 day loan successfully", async function () {
      const principal = ethers.utils.parseEther("200");
      const repayment = ethers.utils.parseEther("220");
      const duration = 30 * 86400;
      const maturity = lastBlockTimestamp + 15 * 86400;

      expect(await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity)).to.equal(
        ethers.utils.parseEther("217.572399108303671479")
      );
    });
    it("prices 0/60 day loan successfully", async function () {
      const principal = ethers.utils.parseEther("200");
      const repayment = ethers.utils.parseEther("220");
      const duration = 60 * 86400;
      const maturity = lastBlockTimestamp + duration;

      expect(await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity)).to.equal(
        ethers.utils.parseEther("205.999581210593115702")
      );
    });
    it("prices 30/60 day loan successfully", async function () {
      const principal = ethers.utils.parseEther("200");
      const repayment = ethers.utils.parseEther("220");
      const duration = 60 * 86400;
      const maturity = lastBlockTimestamp + 30 * 86400;

      expect(await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity)).to.equal(
        ethers.utils.parseEther("215.171583856609272759")
      );
    });
    it("prices 0/90 day loan successfully", async function () {
      const principal = ethers.utils.parseEther("200");
      const repayment = ethers.utils.parseEther("220");
      const duration = 90 * 86400;
      const maturity = lastBlockTimestamp + duration;

      expect(await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity)).to.equal(
        ethers.utils.parseEther("185.123807742220851468")
      );
    });
    it("prices 45/90 day loan successfully", async function () {
      const principal = ethers.utils.parseEther("200");
      const repayment = ethers.utils.parseEther("220");
      const duration = 90 * 86400;
      const maturity = lastBlockTimestamp + 45 * 86400;

      expect(await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity)).to.equal(
        ethers.utils.parseEther("209.413861313696991852")
      );
    });
    it("fails on insufficient time remaining", async function () {
      const principal = ethers.utils.parseEther("200");
      const repayment = ethers.utils.parseEther("220");
      const duration = 30 * 86400;
      const maturity = lastBlockTimestamp + 5 * 86400;

      await expect(
        loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity)
      ).to.be.revertedWith("PriceError_InsufficientTimeRemaining()");
    });
    it("fails on unsupported token contract", async function () {
      const principal = ethers.utils.parseEther("200");
      const repayment = ethers.utils.parseEther("220");
      const duration = 30 * 86400;
      const maturity = lastBlockTimestamp + duration;

      await expect(
        loanPriceOracle.priceLoan(tok1.address, 1234, principal, repayment, duration, maturity)
      ).to.be.revertedWith("PriceError_Unsupported()");
    });
    it("fails on unsupported duration", async function () {
      const principal = ethers.utils.parseEther("200");
      const repayment = ethers.utils.parseEther("220");
      const duration = 120 * 86400;
      const maturity = lastBlockTimestamp + duration;

      await expect(
        loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity)
      ).to.be.revertedWith("PriceError_Unsupported()");
    });
    it("fails on purchase price out of bounds", async function () {
      const principal = ethers.utils.parseEther("1000");
      const repayment = ethers.utils.parseEther("1200");
      const duration = 60 * 86400;
      const maturity = lastBlockTimestamp + duration;

      await expect(
        loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity)
      ).to.be.revertedWith("PriceError_PurchasePriceOutOfBounds()");
    });
  });

  describe("#setTokenParameters", async function () {
    it("sets token parameters successfully", async function () {
      const setTx = await loanPriceOracle.setTokenParameters(nft1.address, encodeTokenParameters(tokenParameters));
      await expectEvent(setTx, loanPriceOracle, "TokenParametersUpdated", {
        tokenContract: nft1.address,
      });

      expect((await loanPriceOracle.parameters(nft1.address, 30 * 86400)).minDiscountRate).to.equal(
        tokenParameters[0].minDiscountRate
      );
      expect((await loanPriceOracle.parameters(nft1.address, 30 * 86400)).aprSensitivity).to.equal(
        tokenParameters[0].aprSensitivity
      );
      expect((await loanPriceOracle.parameters(nft1.address, 30 * 86400)).minPurchasePrice).to.equal(
        tokenParameters[0].minPurchasePrice
      );
      expect((await loanPriceOracle.parameters(nft1.address, 30 * 86400)).maxPurchasePrice).to.equal(
        tokenParameters[0].maxPurchasePrice
      );

      expect((await loanPriceOracle.parameters(nft1.address, 60 * 86400)).minDiscountRate).to.equal(
        tokenParameters[1].minDiscountRate
      );
      expect((await loanPriceOracle.parameters(nft1.address, 60 * 86400)).aprSensitivity).to.equal(
        tokenParameters[1].aprSensitivity
      );
      expect((await loanPriceOracle.parameters(nft1.address, 60 * 86400)).minPurchasePrice).to.equal(
        tokenParameters[1].minPurchasePrice
      );
      expect((await loanPriceOracle.parameters(nft1.address, 60 * 86400)).maxPurchasePrice).to.equal(
        tokenParameters[1].maxPurchasePrice
      );

      expect((await loanPriceOracle.parameters(nft1.address, 90 * 86400)).minDiscountRate).to.equal(
        tokenParameters[2].minDiscountRate
      );
      expect((await loanPriceOracle.parameters(nft1.address, 90 * 86400)).aprSensitivity).to.equal(
        tokenParameters[2].aprSensitivity
      );
      expect((await loanPriceOracle.parameters(nft1.address, 90 * 86400)).minPurchasePrice).to.equal(
        tokenParameters[2].minPurchasePrice
      );
      expect((await loanPriceOracle.parameters(nft1.address, 90 * 86400)).maxPurchasePrice).to.equal(
        tokenParameters[2].maxPurchasePrice
      );
    });
    it("replaces token parameters successfully", async function () {
      await loanPriceOracle.setTokenParameters(nft1.address, encodeTokenParameters(tokenParameters));

      expect((await loanPriceOracle.parameters(nft1.address, 60 * 86400)).minDiscountRate).to.equal(
        tokenParameters[1].minDiscountRate
      );
      expect((await loanPriceOracle.parameters(nft1.address, 60 * 86400)).aprSensitivity).to.equal(
        tokenParameters[1].aprSensitivity
      );
      expect((await loanPriceOracle.parameters(nft1.address, 60 * 86400)).minPurchasePrice).to.equal(
        tokenParameters[1].minPurchasePrice
      );
      expect((await loanPriceOracle.parameters(nft1.address, 60 * 86400)).maxPurchasePrice).to.equal(
        tokenParameters[1].maxPurchasePrice
      );

      const tokenParametersUpdate: TokenParameters[] = [
        {
          duration: 60 * 86400,
          minDiscountRate: normalizeRate("0.50"),
          aprSensitivity: normalizeRate("0.00030"),
          minPurchasePrice: ethers.utils.parseEther("200"),
          maxPurchasePrice: ethers.utils.parseEther("2000"),
        },
      ];

      await loanPriceOracle.setTokenParameters(nft1.address, encodeTokenParameters(tokenParametersUpdate));

      expect((await loanPriceOracle.parameters(nft1.address, 60 * 86400)).minDiscountRate).to.equal(
        tokenParametersUpdate[0].minDiscountRate
      );
      expect((await loanPriceOracle.parameters(nft1.address, 60 * 86400)).aprSensitivity).to.equal(
        tokenParametersUpdate[0].aprSensitivity
      );
      expect((await loanPriceOracle.parameters(nft1.address, 60 * 86400)).minPurchasePrice).to.equal(
        tokenParametersUpdate[0].minPurchasePrice
      );
      expect((await loanPriceOracle.parameters(nft1.address, 60 * 86400)).maxPurchasePrice).to.equal(
        tokenParametersUpdate[0].maxPurchasePrice
      );
    });
    it("fails on invalid caller", async function () {
      await expect(
        loanPriceOracle.connect(accounts[1]).setTokenParameters(nft1.address, encodeTokenParameters(tokenParameters))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
