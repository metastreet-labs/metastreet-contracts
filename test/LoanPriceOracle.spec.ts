import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { TestERC20, TestERC721, StaticCollateralOracle, LoanPriceOracle } from "../typechain";

import { expectEvent } from "./helpers/EventUtilities";
import { randomAddress, getBlockTimestamp } from "./helpers/VaultHelpers";
import { FixedPoint } from "./helpers/FixedPointHelpers";
import {
  UtilizationParameters,
  CollateralParameters,
  encodeUtilizationParameters,
  encodeCollateralParameters,
  computePiecewiseLinearModel,
} from "./helpers/LoanPriceOracleHelpers";

describe("LoanPriceOracle", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let nft1: TestERC721;
  let staticCollateralOracle: StaticCollateralOracle;
  let loanPriceOracle: LoanPriceOracle;
  let snapshotId: string;

  before("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const testERC721Factory = await ethers.getContractFactory("TestERC721");
    const staticCollateralOracleFactory = await ethers.getContractFactory("StaticCollateralOracle");
    const loanPriceOracleFactory = await ethers.getContractFactory("LoanPriceOracle");

    tok1 = (await testERC20Factory.deploy("WETH", "WETH", 18, ethers.utils.parseEther("1000"))) as TestERC20;
    await tok1.deployed();

    nft1 = (await testERC721Factory.deploy("NFT 1", "NFT1", "https://nft1.com/token/")) as TestERC721;
    await nft1.deployed();

    staticCollateralOracle = (await staticCollateralOracleFactory.deploy(tok1.address)) as StaticCollateralOracle;
    await staticCollateralOracle.deployed();

    loanPriceOracle = (await loanPriceOracleFactory.deploy(staticCollateralOracle.address)) as LoanPriceOracle;
    await loanPriceOracle.deployed();
  });

  beforeEach("snapshot blockchain", async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);
  });

  afterEach("restore blockchain snapshot", async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  const minimumLoanDuration = 7 * 86400;

  const utilizationParameters: UtilizationParameters = computePiecewiseLinearModel({
    minRate: FixedPoint.normalizeRate("0.05"),
    targetRate: FixedPoint.normalizeRate("0.10"),
    maxRate: FixedPoint.normalizeRate("2.00"),
    target: FixedPoint.from("0.90"),
    max: FixedPoint.from("1.00"),
  });

  const collateralValue = ethers.utils.parseEther("100");

  const collateralParameters: CollateralParameters = {
    active: true,
    loanToValueRateComponent: computePiecewiseLinearModel({
      minRate: FixedPoint.normalizeRate("0.05"),
      targetRate: FixedPoint.normalizeRate("0.10"),
      maxRate: FixedPoint.normalizeRate("2.00"),
      target: FixedPoint.from("0.30"),
      max: FixedPoint.from("0.60"),
    }),
    durationRateComponent: computePiecewiseLinearModel({
      minRate: FixedPoint.normalizeRate("0.05"),
      targetRate: FixedPoint.normalizeRate("0.10"),
      maxRate: FixedPoint.normalizeRate("2.00"),
      target: FixedPoint.from(30 * 86400),
      max: FixedPoint.from(90 * 86400),
    }),
    rateComponentWeights: [5000, 2500, 2500],
  };

  describe("getters", async function () {
    it("currency token matches collateral oracle", async function () {
      expect(await loanPriceOracle.currencyToken()).to.equal(tok1.address);
    });
    it("roles are correct", async function () {
      expect(
        await loanPriceOracle.hasRole(await staticCollateralOracle.DEFAULT_ADMIN_ROLE(), accounts[0].address)
      ).to.equal(true);
      expect(
        await loanPriceOracle.hasRole(await staticCollateralOracle.PARAMETER_ADMIN_ROLE(), accounts[0].address)
      ).to.equal(true);
    });
  });

  describe("constants", async function () {
    it("matches implementation version", async function () {
      expect(await loanPriceOracle.IMPLEMENTATION_VERSION()).to.equal("1.2");
    });
  });

  describe("constructor", async function () {
    it("fails on unsupported currency token decimals", async function () {
      const testERC20Factory = await ethers.getContractFactory("TestERC20");
      const tok2 = (await testERC20Factory.deploy("TOK2", "TOK2", 6, ethers.utils.parseEther("1000000"))) as TestERC20;
      await tok2.deployed();

      const staticCollateralOracleFactory = await ethers.getContractFactory("StaticCollateralOracle");
      const staticCollateralOracle2 = (await staticCollateralOracleFactory.deploy(
        tok2.address
      )) as StaticCollateralOracle;
      await staticCollateralOracle2.deployed();

      const loanPriceOracleFactory = await ethers.getContractFactory("LoanPriceOracle");
      await expect(loanPriceOracleFactory.deploy(staticCollateralOracle2.address)).to.be.revertedWith(
        "UnsupportedTokenDecimals()"
      );
    });
  });

  describe("#priceLoan", async function () {
    beforeEach("setup token parameters", async () => {
      await staticCollateralOracle.setCollateralValue(nft1.address, collateralValue);
      await loanPriceOracle.setMinimumLoanDuration(minimumLoanDuration);
      await loanPriceOracle.setUtilizationParameters(encodeUtilizationParameters(utilizationParameters));
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
        encodeCollateralParameters({ ...collateralParameters, rateComponentWeights: [10000, 0, 0] })
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
        encodeCollateralParameters({ ...collateralParameters, rateComponentWeights: [0, 10000, 0] })
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
        encodeCollateralParameters({ ...collateralParameters, rateComponentWeights: [0, 0, 10000] })
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
      ).to.be.revertedWith("InsufficientTimeRemaining()");
    });
    it("fails on unsupported token contract", async function () {
      const principal = ethers.utils.parseEther("20");
      const repayment = ethers.utils.parseEther("22");
      const duration = 30 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("0.90");

      await expect(
        loanPriceOracle.priceLoan(tok1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.be.revertedWith("UnsupportedCollateral()");
    });
    it("fails on parameter out of bounds (utilization)", async function () {
      const principal = ethers.utils.parseEther("20");
      const repayment = ethers.utils.parseEther("22");
      const duration = 30 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("1.10"); /* not actually possible */

      await expect(
        loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.be.revertedWith("ParameterOutOfBounds", 0);
    });
    it("fails on parameters out of bounds (loan to value)", async function () {
      const principal = ethers.utils.parseEther("100");
      const repayment = ethers.utils.parseEther("120");
      const duration = 60 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("0.90");

      await expect(
        loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.be.revertedWith("ParameterOutOfBounds", 1);
    });
    it("fails on parameter out of bounds (duration)", async function () {
      const principal = ethers.utils.parseEther("20");
      const repayment = ethers.utils.parseEther("22");
      const duration = 120 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("0.90");

      await expect(
        loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.be.revertedWith("ParameterOutOfBounds", 2);
    });
    it("fails on parameter out of bounds (purchase price)", async function () {
      const principal = ethers.utils.parseEther("20");
      const repayment = ethers.utils.parseEther("70");
      const duration = 60 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("0.90");

      await expect(
        loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.be.revertedWith("ParameterOutOfBounds", 3);
    });
  });

  describe("#priceLoanRepayment", async function () {
    beforeEach("setup token parameters", async () => {
      await staticCollateralOracle.setCollateralValue(nft1.address, collateralValue);
      await loanPriceOracle.setMinimumLoanDuration(minimumLoanDuration);
      await loanPriceOracle.setUtilizationParameters(encodeUtilizationParameters(utilizationParameters));
      await loanPriceOracle.setCollateralParameters(nft1.address, encodeCollateralParameters(collateralParameters));
    });

    it("price loan repayment on utilization component", async function () {
      const principal = ethers.utils.parseEther("20");
      const duration = 30 * 86400;
      const utilization1 = FixedPoint.from("0.25");
      const utilization2 = FixedPoint.from("0.95");

      /* Override weights */
      await loanPriceOracle.setCollateralParameters(
        nft1.address,
        encodeCollateralParameters({ ...collateralParameters, rateComponentWeights: [10000, 0, 0] })
      );

      expect(await loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal, duration, utilization1)).to.equal(
        ethers.utils.parseEther("20.105022831063680001")
      );

      expect(await loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal, duration, utilization2)).to.equal(
        ethers.utils.parseEther("21.726027397262720001")
      );
    });
    it("price loan repayment on loan-to-value component", async function () {
      const principal1 = ethers.utils.parseEther("20");
      const principal2 = ethers.utils.parseEther("40");
      const duration = 30 * 86400;
      const utilization = FixedPoint.from("0.90");

      /* Override weights */
      await loanPriceOracle.setCollateralParameters(
        nft1.address,
        encodeCollateralParameters({ ...collateralParameters, rateComponentWeights: [0, 10000, 0] })
      );

      expect(await loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal1, duration, utilization)).to.equal(
        ethers.utils.parseEther("20.136986301353600001")
      );

      expect(await loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal2, duration, utilization)).to.equal(
        ethers.utils.parseEther("42.410958904030720001")
      );
    });
    it("price loan repayment on duration component", async function () {
      const principal = ethers.utils.parseEther("20");
      const duration1 = 20 * 86400;
      const duration2 = 60 * 86400;
      const utilization = FixedPoint.from("0.90");

      /* Override weights */
      await loanPriceOracle.setCollateralParameters(
        nft1.address,
        encodeCollateralParameters({ ...collateralParameters, rateComponentWeights: [0, 0, 10000] })
      );

      expect(await loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal, duration1, utilization)).to.equal(
        ethers.utils.parseEther("20.091283245021440001")
      );

      expect(await loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal, duration2, utilization)).to.equal(
        ethers.utils.parseEther("23.451862366104320001")
      );
    });
    it("price loan repayment on all components", async function () {
      const principal = ethers.utils.parseEther("20");
      const duration = 35 * 86400;
      const utilization = FixedPoint.from("0.85");

      expect(await loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal, duration, utilization)).to.equal(
        ethers.utils.parseEther("20.257012498957760001")
      );
    });
    it("price loan repayment matches price loan", async function () {
      const principal = ethers.utils.parseEther("20");
      const duration = 35 * 86400;
      const maturity = (await getBlockTimestamp()) + duration;
      const utilization = FixedPoint.from("0.85");

      const repayment = await loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal, duration, utilization);
      expect(
        await loanPriceOracle.priceLoan(nft1.address, 1234, principal, repayment, duration, maturity, utilization)
      ).to.equal(principal);
    });
    it("price loan for zero principal", async function () {
      const principal = ethers.constants.Zero;
      const duration = 35 * 86400;
      const utilization = FixedPoint.from("0.85");

      expect(await loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal, duration, utilization)).to.equal(
        ethers.utils.parseEther("0.000000000000000001")
      );
    });
    it("fails on insufficient time remaining", async function () {
      const principal = ethers.utils.parseEther("20");
      const duration = 1 * 86400;
      const utilization = FixedPoint.from("0.90");

      await expect(
        loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal, duration, utilization)
      ).to.be.revertedWith("InsufficientTimeRemaining()");
    });
    it("fails on unsupported token contract", async function () {
      const principal = ethers.utils.parseEther("20");
      const duration = 30 * 86400;
      const utilization = FixedPoint.from("0.90");

      await expect(
        loanPriceOracle.priceLoanRepayment(tok1.address, 1234, principal, duration, utilization)
      ).to.be.revertedWith("UnsupportedCollateral()");
    });
    it("fails on parameter out of bounds (utilization)", async function () {
      const principal = ethers.utils.parseEther("20");
      const duration = 30 * 86400;
      const utilization = FixedPoint.from("1.10"); /* not actually possible */

      await expect(
        loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal, duration, utilization)
      ).to.be.revertedWith("ParameterOutOfBounds", 0);
    });
    it("fails on parameters out of bounds (loan to value)", async function () {
      const principal = ethers.utils.parseEther("100");
      const duration = 60 * 86400;
      const utilization = FixedPoint.from("0.90");

      await expect(
        loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal, duration, utilization)
      ).to.be.revertedWith("ParameterOutOfBounds", 1);
    });
    it("fails on parameter out of bounds (duration)", async function () {
      const principal = ethers.utils.parseEther("20");
      const duration = 120 * 86400;
      const utilization = FixedPoint.from("0.90");

      await expect(
        loanPriceOracle.priceLoanRepayment(nft1.address, 1234, principal, duration, utilization)
      ).to.be.revertedWith("ParameterOutOfBounds", 2);
    });
  });

  describe("#setUtilizationParameters", async function () {
    it("sets utilization parameters successfully", async function () {
      const setTx = await loanPriceOracle.setUtilizationParameters(encodeUtilizationParameters(utilizationParameters));
      await expectEvent(setTx, loanPriceOracle, "UtilizationParametersUpdated", {});

      expect(await loanPriceOracle.getUtilizationParameters()).to.deep.equal(Object.values(utilizationParameters));
    });
    it("fails on invalid caller", async function () {
      await expect(
        loanPriceOracle
          .connect(accounts[1])
          .setUtilizationParameters(encodeUtilizationParameters(utilizationParameters))
      ).to.be.revertedWith("AccessControl: account");

      await loanPriceOracle.revokeRole(await loanPriceOracle.PARAMETER_ADMIN_ROLE(), accounts[0].address);
      await expect(
        loanPriceOracle.setUtilizationParameters(encodeUtilizationParameters(utilizationParameters))
      ).to.be.revertedWith("AccessControl: account");
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

      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).active).to.equal(true);
      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).loanToValueRateComponent).to.deep.equal(
        Object.values(collateralParameters.loanToValueRateComponent)
      );
      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).durationRateComponent).to.deep.equal(
        Object.values(collateralParameters.durationRateComponent)
      );
      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).rateComponentWeights).to.deep.equal(
        collateralParameters.rateComponentWeights
      );
    });
    it("replaces collateral parameters successfully", async function () {
      await loanPriceOracle.setCollateralParameters(nft1.address, encodeCollateralParameters(collateralParameters));

      const collateralParametersUpdate: CollateralParameters = {
        ...collateralParameters,
        durationRateComponent: computePiecewiseLinearModel({
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

      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).active).to.equal(true);
      expect((await loanPriceOracle.getCollateralParameters(nft1.address)).durationRateComponent).to.deep.equal(
        Object.values(collateralParametersUpdate.durationRateComponent)
      );
    });
    it("set multiple collateral parameters successfully", async function () {
      const collateralTokens = [randomAddress(), randomAddress(), randomAddress()];

      await loanPriceOracle.setCollateralParameters(
        collateralTokens[0],
        encodeCollateralParameters(collateralParameters)
      );
      await loanPriceOracle.setCollateralParameters(
        collateralTokens[1],
        encodeCollateralParameters(collateralParameters)
      );
      await loanPriceOracle.setCollateralParameters(
        collateralTokens[2],
        encodeCollateralParameters(collateralParameters)
      );

      expect([...(await loanPriceOracle.supportedCollateralTokens())].sort()).to.deep.equal(collateralTokens.sort());

      /* Disable collateral token 1 */
      await loanPriceOracle.setCollateralParameters(
        collateralTokens[1],
        encodeCollateralParameters({ ...collateralParameters, active: false })
      );

      expect([...(await loanPriceOracle.supportedCollateralTokens())].sort()).to.deep.equal(
        [collateralTokens[0], collateralTokens[2]].sort()
      );
    });
    it("fails on invalid rate component weights", async function () {
      await expect(
        loanPriceOracle.setCollateralParameters(
          nft1.address,
          encodeCollateralParameters({ ...collateralParameters, rateComponentWeights: [5000, 2500, 2501] })
        )
      ).to.be.revertedWith("ParameterOutOfBounds(4)");
    });
    it("fails on invalid address", async function () {
      await expect(
        loanPriceOracle.setCollateralParameters(
          ethers.constants.AddressZero,
          encodeCollateralParameters(collateralParameters)
        )
      ).to.be.revertedWith("InvalidAddress()");
    });
    it("fails on invalid caller", async function () {
      await expect(
        loanPriceOracle
          .connect(accounts[1])
          .setCollateralParameters(nft1.address, encodeCollateralParameters(collateralParameters))
      ).to.be.revertedWith("AccessControl: account");

      await loanPriceOracle.revokeRole(await loanPriceOracle.PARAMETER_ADMIN_ROLE(), accounts[0].address);
      await expect(
        loanPriceOracle.setCollateralParameters(nft1.address, encodeCollateralParameters(collateralParameters))
      ).to.be.revertedWith("AccessControl: account");
    });
  });

  describe("#setMinimumLoanDuration", async function () {
    it("sets minimum loan duration successfully", async function () {
      const duration = 14 * 86400;

      const setTx = await loanPriceOracle.setMinimumLoanDuration(duration);
      await expectEvent(setTx, loanPriceOracle, "MinimumLoanDurationUpdated", {
        duration,
      });

      expect(await loanPriceOracle.minimumLoanDuration()).to.equal(duration);
    });
    it("fails on invalid caller", async function () {
      await expect(loanPriceOracle.connect(accounts[1]).setMinimumLoanDuration(7 * 86400)).to.be.revertedWith(
        "AccessControl: account"
      );

      await loanPriceOracle.revokeRole(await loanPriceOracle.PARAMETER_ADMIN_ROLE(), accounts[0].address);
      await expect(loanPriceOracle.setMinimumLoanDuration(7 * 86400)).to.be.revertedWith("AccessControl: account");
    });
  });

  describe("#setCollateralOracle", async function () {
    it("sets collateral oracle successfully", async function () {
      const staticCollateralOracleFactory = await ethers.getContractFactory("StaticCollateralOracle");
      const staticCollateralOracle2 = (await staticCollateralOracleFactory.deploy(
        tok1.address
      )) as StaticCollateralOracle;
      await staticCollateralOracle2.deployed();

      const setTx = await loanPriceOracle.setCollateralOracle(staticCollateralOracle2.address);
      await expectEvent(setTx, loanPriceOracle, "CollateralOracleUpdated", {
        collateralOracle: staticCollateralOracle2.address,
      });

      expect(await loanPriceOracle.collateralOracle()).to.equal(staticCollateralOracle2.address);
    });
    it("fails on unsupported token decimals", async function () {
      const testERC20Factory = await ethers.getContractFactory("TestERC20");
      const tok2 = (await testERC20Factory.deploy("TOK2", "TOK2", 6, ethers.utils.parseEther("1000000"))) as TestERC20;
      await tok2.deployed();

      const staticCollateralOracleFactory = await ethers.getContractFactory("StaticCollateralOracle");
      const staticCollateralOracle2 = (await staticCollateralOracleFactory.deploy(
        tok2.address
      )) as StaticCollateralOracle;
      await staticCollateralOracle2.deployed();

      await expect(loanPriceOracle.setCollateralOracle(staticCollateralOracle2.address)).to.be.revertedWith(
        "UnsupportedTokenDecimals()"
      );
    });
    it("fails on invalid caller", async function () {
      await expect(loanPriceOracle.connect(accounts[1]).setCollateralOracle(randomAddress())).to.be.revertedWith(
        "AccessControl: account"
      );
    });
  });

  describe("#supportsInterface", async function () {
    it("returns true on supported interfaces", async function () {
      /* ERC165 */
      expect(
        await loanPriceOracle.supportsInterface(loanPriceOracle.interface.getSighash("supportsInterface"))
      ).to.equal(true);
      /* AccessControl */
      expect(
        await loanPriceOracle.supportsInterface(
          ethers.utils.hexlify(
            [
              loanPriceOracle.interface.getSighash("hasRole"),
              loanPriceOracle.interface.getSighash("getRoleAdmin"),
              loanPriceOracle.interface.getSighash("grantRole"),
              loanPriceOracle.interface.getSighash("revokeRole"),
              loanPriceOracle.interface.getSighash("renounceRole"),
            ].reduce((acc, value) => acc.xor(ethers.BigNumber.from(value)), ethers.constants.Zero)
          )
        )
      ).to.equal(true);
    });
    it("returns false on unsupported interfaces", async function () {
      expect(await loanPriceOracle.supportsInterface("0xaabbccdd")).to.equal(false);
      expect(await loanPriceOracle.supportsInterface("0x00000000")).to.equal(false);
      expect(await loanPriceOracle.supportsInterface("0xffffffff")).to.equal(false);
    });
  });
});
