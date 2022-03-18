import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { TestERC20, TestERC721, LoanPriceOracle } from "../typechain";

import { expectEvent } from "./helpers/EventUtilities";
import { getBlockTimestamp } from "./helpers/VaultHelpers";
import { FixedPoint } from "./helpers/FixedPointHelpers";
import {
  CollateralParameters,
  encodeCollateralParameters,
  computePiecewiseLinearModel,
} from "./helpers/LoanPriceOracleHelpers";

describe("LoanPriceOracle", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let nft1: TestERC721;
  let loanPriceOracle: LoanPriceOracle;
  let snapshotId: string;

  before("deploy fixture", async () => {
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
  });

  beforeEach("snapshot blockchain", async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);
  });

  afterEach("restore blockchain snapshot", async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  const minimumDiscountRate = FixedPoint.normalizeRate("0.05");
  const minimumLoanDuration = 7 * 86400;

  const collateralParameters: CollateralParameters = {
    collateralValue: ethers.utils.parseEther("100"),
    rateUtilizationSensitivity: computePiecewiseLinearModel({
      minRate: FixedPoint.normalizeRate("0.05"),
      targetRate: FixedPoint.normalizeRate("0.10"),
      maxRate: FixedPoint.normalizeRate("2.00"),
      target: FixedPoint.from("0.90"),
      max: FixedPoint.from("1.00"),
    }),
    rateLoanToValueSensitivity: computePiecewiseLinearModel({
      minRate: FixedPoint.normalizeRate("0.05"),
      targetRate: FixedPoint.normalizeRate("0.10"),
      maxRate: FixedPoint.normalizeRate("2.00"),
      target: FixedPoint.from("0.30"),
      max: FixedPoint.from("0.60"),
    }),
    rateDurationSensitivity: computePiecewiseLinearModel({
      minRate: FixedPoint.normalizeRate("0.05"),
      targetRate: FixedPoint.normalizeRate("0.10"),
      maxRate: FixedPoint.normalizeRate("2.00"),
      target: FixedPoint.from(30 * 86400),
      max: FixedPoint.from(90 * 86400),
    }),
    sensitivityWeights: [50, 25, 25],
  };

  describe("constants", async function () {
    it("matches implementation version", async function () {
      expect(await loanPriceOracle.IMPLEMENTATION_VERSION()).to.equal("1.0");
    });
  });

  describe("#priceLoan", async function () {
    beforeEach("setup token parameters", async () => {
      await loanPriceOracle.setMinimumDiscountRate(minimumDiscountRate);
      await loanPriceOracle.setMinimumLoanDuration(minimumLoanDuration);
      await loanPriceOracle.setCollateralParameters(nft1.address, encodeCollateralParameters(collateralParameters));
    });

    it("price loan on utilization component", async function () {
      const principal = ethers.utils.parseEther("20");
      const repayment = ethers.utils.parseEther("22");
      const duration = 30 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization1 = FixedPoint.from("0.25");
      const utilization2 = FixedPoint.from("0.95");

      /* Override weights */
      await loanPriceOracle.setCollateralParameters(
        nft1.address,
        encodeCollateralParameters({ ...collateralParameters, sensitivityWeights: [100, 0, 0] })
      );

      expect(
        await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization1)
      ).to.equal(ethers.utils.parseEther("21.885078399757398560"));

      expect(
        await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization2)
      ).to.equal(ethers.utils.parseEther("20.252207430314432161"));
    });
    it("price loan on loan-to-value component", async function () {
      const principal1 = ethers.utils.parseEther("20");
      const repayment1 = ethers.utils.parseEther("22");
      const principal2 = ethers.utils.parseEther("40");
      const repayment2 = ethers.utils.parseEther("44");
      const duration = 30 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("0.90");

      /* Override weights */
      await loanPriceOracle.setCollateralParameters(
        nft1.address,
        encodeCollateralParameters({ ...collateralParameters, sensitivityWeights: [0, 100, 0] })
      );

      expect(
        await loanPriceOracle.priceLoan(nft1.address, 1234, principal1, repayment1, duration, maturity, utilization)
      ).to.equal(ethers.utils.parseEther("21.850340193418430404"));

      expect(
        await loanPriceOracle.priceLoan(nft1.address, 1234, principal2, repayment2, duration, maturity, utilization)
      ).to.equal(ethers.utils.parseEther("41.498708920559591380"));
    });
    it("price loan on duration component", async function () {
      const principal = ethers.utils.parseEther("20");
      const repayment = ethers.utils.parseEther("22");
      const duration1 = 20 * 86400;
      const maturity1 = (await getBlockTimestamp()) + duration1;
      const duration2 = 60 * 86400;
      const maturity2 = (await getBlockTimestamp()) + duration2;
      const utilization = FixedPoint.from("0.90");

      /* Override weights */
      await loanPriceOracle.setCollateralParameters(
        nft1.address,
        encodeCollateralParameters({ ...collateralParameters, sensitivityWeights: [0, 0, 100] })
      );

      expect(
        await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration1, maturity1, utilization)
      ).to.equal(ethers.utils.parseEther("21.900044723542782084"));

      expect(
        await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration2, maturity2, utilization)
      ).to.equal(ethers.utils.parseEther("18.761837683999453611"));
    });
    it("price loan on all components", async function () {
      const principal = ethers.utils.parseEther("20");
      const repayment = ethers.utils.parseEther("22");
      const duration = 35 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("0.85");

      expect(
        await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.equal(ethers.utils.parseEther("21.720873204903159480"));
    });
    it("price loan for zero repayment", async function () {
      const principal = ethers.utils.parseEther("20");
      const repayment = ethers.constants.Zero;
      const duration = 35 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("0.85");

      expect(
        await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.equal(ethers.utils.parseEther("0"));
    });
    it("fails on insufficient time remaining", async function () {
      const principal = ethers.utils.parseEther("20");
      const repayment = ethers.utils.parseEther("22");
      const duration = 30 * 86400;
      const maturity = (await getBlockTimestamp()) + 5 * 86400;
      const utilization = FixedPoint.from("0.90");

      await expect(
        loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.be.revertedWith("PriceError_InsufficientTimeRemaining()");
    });
    it("fails on unsupported token contract", async function () {
      const principal = ethers.utils.parseEther("20");
      const repayment = ethers.utils.parseEther("22");
      const duration = 30 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("0.90");

      await expect(
        loanPriceOracle.priceLoan(tok1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.be.revertedWith("PriceError_UnsupportedCollateral()");
    });
    it("fails on parameter out of bounds (utilization)", async function () {
      const principal = ethers.utils.parseEther("20");
      const repayment = ethers.utils.parseEther("22");
      const duration = 30 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("1.10"); /* not actually possible */

      await expect(
        loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.be.revertedWith("PriceError_ParameterOutOfBounds(0)");
    });
    it("fails on parameters out of bounds (loan to value)", async function () {
      const principal = ethers.utils.parseEther("100");
      const repayment = ethers.utils.parseEther("120");
      const duration = 60 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("0.90");

      await expect(
        loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.be.revertedWith("PriceError_ParameterOutOfBounds(1)");
    });
    it("fails on parameter out of bounds (duration)", async function () {
      const principal = ethers.utils.parseEther("20");
      const repayment = ethers.utils.parseEther("22");
      const duration = 120 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("0.90");

      await expect(
        loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.be.revertedWith("PriceError_ParameterOutOfBounds(2)");
    });
  });

  describe("#setCollateralParameters", async function () {
    it("sets collateral parameters successfully", async function () {
      const setTx = await loanPriceOracle.setCollateralParameters(
        nft1.address,
        encodeCollateralParameters(collateralParameters)
      );
      await expectEvent(setTx, loanPriceOracle, "CollateralParametersUpdated", {
        collateralToken: nft1.address,
      });

      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).collateralValue).to.equal(
        collateralParameters.collateralValue
      );
      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).rateUtilizationSensitivity).to.deep.equal(
        Object.values(collateralParameters.rateUtilizationSensitivity)
      );
      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).rateLoanToValueSensitivity).to.deep.equal(
        Object.values(collateralParameters.rateLoanToValueSensitivity)
      );
      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).rateDurationSensitivity).to.deep.equal(
        Object.values(collateralParameters.rateDurationSensitivity)
      );
      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).sensitivityWeights).to.deep.equal(
        collateralParameters.sensitivityWeights
      );
    });
    it("replaces collateral parameters successfully", async function () {
      await loanPriceOracle.setCollateralParameters(nft1.address, encodeCollateralParameters(collateralParameters));

      const collateralParametersUpdate: CollateralParameters = {
        ...collateralParameters,
        collateralValue: ethers.utils.parseEther("125"),
        rateDurationSensitivity: computePiecewiseLinearModel({
          minRate: FixedPoint.normalizeRate("0.05"),
          targetRate: FixedPoint.normalizeRate("0.15"),
          maxRate: FixedPoint.normalizeRate("2.00"),
          target: FixedPoint.from(40 * 86400),
          max: FixedPoint.from(120 * 86400),
        }),
      };

      await loanPriceOracle.setCollateralParameters(
        nft1.address,
        encodeCollateralParameters(collateralParametersUpdate)
      );

      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).collateralValue).to.equal(
        collateralParametersUpdate.collateralValue
      );
      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).rateDurationSensitivity).to.deep.equal(
        Object.values(collateralParametersUpdate.rateDurationSensitivity)
      );
    });
    it("fails on invalid address", async function () {
      await expect(
        loanPriceOracle.setCollateralParameters(
          ethers.constants.AddressZero,
          encodeCollateralParameters(collateralParameters)
        )
      ).to.be.revertedWith("Invalid address");
    });
    it("fails on invalid caller", async function () {
      await expect(
        loanPriceOracle
          .connect(accounts[1])
          .setCollateralParameters(nft1.address, encodeCollateralParameters(collateralParameters))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("#setMinimumDiscountRate", async function () {
    it("sets minimum discount rate successfully", async function () {
      const rate = FixedPoint.normalizeRate("0.075");

      await loanPriceOracle.setMinimumDiscountRate(rate);
      expect(await loanPriceOracle.minimumDiscountRate()).to.equal(rate);
    });
    it("fails on invalid caller", async function () {
      await expect(
        loanPriceOracle.connect(accounts[1]).setMinimumDiscountRate(FixedPoint.normalizeRate("0.05"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("#setMinimumLoanDuration", async function () {
    it("sets minimum loan duration successfully", async function () {
      const duration = 14 * 86400;

      await loanPriceOracle.setMinimumLoanDuration(duration);
      expect(await loanPriceOracle.minimumLoanDuration()).to.equal(duration);
    });
    it("fails on invalid caller", async function () {
      await expect(loanPriceOracle.connect(accounts[1]).setMinimumLoanDuration(7 * 86400)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });
});
