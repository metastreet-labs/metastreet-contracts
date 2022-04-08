import { expect } from "chai";
import { ethers, network } from "hardhat";

import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import {
  TestERC20,
  TestERC721,
  TestLendingPlatform,
  TestNoteToken,
  TestNoteAdapter,
  MockLoanPriceOracle,
  Vault,
  LPToken,
} from "../typechain";

import {
  initializeAccounts,
  createAndSellLoan,
  cycleLoan,
  cycleLoanDefault,
  getBlockTimestamp,
  elapseTime,
} from "./helpers/VaultHelpers";
import { FixedPoint } from "./helpers/FixedPointHelpers";

describe("Vault Accounting", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let nft1: TestERC721;
  let lendingPlatform: TestLendingPlatform;
  let noteToken: TestNoteToken;
  let mockLoanPriceOracle: MockLoanPriceOracle;
  let testNoteAdapter: TestNoteAdapter;
  let vault: Vault;
  let seniorLPToken: LPToken;
  let juniorLPToken: LPToken;
  let snapshotId: string;

  /* Account references */
  let accountBorrower: SignerWithAddress;
  let accountLender: SignerWithAddress;
  let accountDepositor: SignerWithAddress;
  let accountLiquidator: SignerWithAddress;

  before("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const testERC721Factory = await ethers.getContractFactory("TestERC721");
    const testLendingPlatformFactory = await ethers.getContractFactory("TestLendingPlatform");
    const testNoteAdapterFactory = await ethers.getContractFactory("TestNoteAdapter");
    const mockLoanPriceOracleFactory = await ethers.getContractFactory("MockLoanPriceOracle");
    const lpTokenFactory = await ethers.getContractFactory("LPToken");
    const vaultFactory = await ethers.getContractFactory("Vault");

    /* Deploy test token */
    tok1 = (await testERC20Factory.deploy("WETH", "WETH", 18, ethers.utils.parseEther("1000000"))) as TestERC20;
    await tok1.deployed();

    /* Deploy test NFT */
    nft1 = (await testERC721Factory.deploy("NFT 1", "NFT1", "https://nft1.com/token/")) as TestERC721;
    await nft1.deployed();

    /* Deploy lending platform */
    lendingPlatform = (await testLendingPlatformFactory.deploy(tok1.address)) as TestLendingPlatform;
    await lendingPlatform.deployed();

    /* Get lending platform's note token */
    noteToken = (await ethers.getContractAt(
      "TestNoteToken",
      await lendingPlatform.noteToken(),
      accounts[0]
    )) as TestNoteToken;

    /* Deploy test note adapter */
    testNoteAdapter = (await testNoteAdapterFactory.deploy(lendingPlatform.address)) as TestNoteAdapter;
    await testNoteAdapter.deployed();

    /* Deploy loan price oracle */
    mockLoanPriceOracle = (await mockLoanPriceOracleFactory.deploy(tok1.address)) as MockLoanPriceOracle;
    await mockLoanPriceOracle.deployed();

    /* Deploy Senior LP token */
    seniorLPToken = (await lpTokenFactory.deploy()) as LPToken;
    await seniorLPToken.deployed();
    await seniorLPToken.initialize("Senior LP Token", "msLP-TEST-WETH");

    /* Deploy Junior LP token */
    juniorLPToken = (await lpTokenFactory.deploy()) as LPToken;
    await juniorLPToken.deployed();
    await juniorLPToken.initialize("Junior LP Token", "mjLP-TEST-WETH");

    /* Deploy vault */
    vault = (await vaultFactory.deploy()) as Vault;
    await vault.deployed();
    await vault.initialize(
      "Test Vault",
      tok1.address,
      mockLoanPriceOracle.address,
      seniorLPToken.address,
      juniorLPToken.address
    );

    /* Transfer ownership of LP tokens to Vault */
    await seniorLPToken.transferOwnership(vault.address);
    await juniorLPToken.transferOwnership(vault.address);

    /* Setup vault */
    await vault.setNoteAdapter(noteToken.address, testNoteAdapter.address);
    await vault.setSeniorTrancheRate(FixedPoint.normalizeRate("0.05"));
    await vault.setReserveRatio(FixedPoint.from("0.10"));
    await vault.grantRole(await vault.COLLATERAL_LIQUIDATOR_ROLE(), accounts[6].address);

    /* Setup accounts */
    accountBorrower = accounts[1];
    accountLender = accounts[2];
    accountDepositor = accounts[4];
    accountLiquidator = accounts[6];

    await initializeAccounts(
      accountBorrower,
      accountLender,
      accountDepositor,
      accountLiquidator,
      nft1,
      tok1,
      lendingPlatform,
      vault
    );
  });

  beforeEach("snapshot blockchain", async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);
  });

  afterEach("restore blockchain snapshot", async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  describe("tranche returns and realized value", async function () {
    it("only senior tranche", async function () {
      const depositAmount = ethers.utils.parseEther("10");
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmount);

      /* Check vault realized value and share price before */
      expect((await vault.trancheState(0)).realizedValue).to.equal(depositAmount);
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.constants.Zero);
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));

      /* Cycle a loan */
      const loanId = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment
      );

      /* Check tranche returns */
      expect((await vault.loanState(noteToken.address, loanId)).seniorTrancheReturn).to.equal(
        ethers.utils.parseEther("0.008219171739257604")
      );

      /* Check vault realized value and share price after */
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.utils.parseEther("10.008219171739257604"));
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.utils.parseEther("0.191780828260742396"));
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1.000821917173925760"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));
    });
    it("only junior tranche", async function () {
      const depositAmount = ethers.utils.parseEther("10");
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(1, depositAmount);

      /* Check vault realized value and share price before */
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(1)).realizedValue).to.equal(depositAmount);
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));

      /* Cycle a loan */
      const loanId = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment
      );

      /* Check tranche returns */
      expect((await vault.loanState(noteToken.address, loanId)).seniorTrancheReturn).to.equal(ethers.constants.Zero);

      /* Check vault realized value and share price after */
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.utils.parseEther("10.2"));
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1.02"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));
    });
    it("increase from repayment", async function () {
      const depositAmounts = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Check vault realized value and share price before */
      expect((await vault.trancheState(0)).realizedValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).realizedValue).to.equal(depositAmounts[1]);
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));

      /* Cycle a loan */
      const loanId = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment
      );

      /* Check tranche returns */
      expect((await vault.loanState(noteToken.address, loanId)).seniorTrancheReturn).to.equal(
        ethers.utils.parseEther("0.005479447826171736")
      );

      /* Check vault realized value and share price after */
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.utils.parseEther("10.005479447826171736"));
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.utils.parseEther("5.194520552173828264"));
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1.000547944782617173"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1.038904110434765652"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));
    });
    it("decrease from default, only junior tranche", async function () {
      const depositAmounts = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Check vault realized value and share price before */
      expect((await vault.trancheState(0)).realizedValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).realizedValue).to.equal(depositAmounts[1]);
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));

      /* Cycle a defaulted loan */
      await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment
      );

      /* Check vault realized value and share price after */
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.utils.parseEther("10"));
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.utils.parseEther("3"));
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("0.6"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));
    });
    it("decrease from default, both junior tranche and senior tranche", async function () {
      const depositAmounts = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("7.0");
      const repayment = ethers.utils.parseEther("7.7");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Check vault realized value and share price before */
      expect((await vault.trancheState(0)).realizedValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).realizedValue).to.equal(depositAmounts[1]);
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));

      /* Cycle a defaulted loan */
      await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment
      );

      /* Check vault realized value and share price after */
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.utils.parseEther("8"));
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.utils.parseEther("0"));
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("0.8"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("0"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));
    });
    it("collateral liquidation, junior tranche recovery", async function () {
      const depositAmounts = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Check vault realized value and share price before */
      expect((await vault.trancheState(0)).realizedValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).realizedValue).to.equal(depositAmounts[1]);
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment
      );

      /* Withdraw the collateral */
      await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);

      /* Callback vault */
      await vault
        .connect(accountLiquidator)
        .onCollateralLiquidated(
          noteToken.address,
          loanId,
          principal.add(ethers.utils.parseEther("0.005479447826171736"))
        );

      /* Check vault realized value and share price after */
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.utils.parseEther("10.005479447826171736"));
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.utils.parseEther("5"));
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1.000547944782617173"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));
    });
    it("collateral liquidation, senior tranche recovery", async function () {
      const depositAmounts = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("7.0");
      const repayment = ethers.utils.parseEther("7.7");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Check vault realized value and share price before */
      expect((await vault.trancheState(0)).realizedValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).realizedValue).to.equal(depositAmounts[1]);
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment
      );

      /* Withdraw the collateral */
      await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);

      /* Callback vault */
      await vault
        .connect(accountLiquidator)
        .onCollateralLiquidated(noteToken.address, loanId, ethers.utils.parseEther("2"));

      /* Check vault realized value and share price after */
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.utils.parseEther("10"));
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.utils.parseEther("0"));
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("0"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));
    });
    it("increase from liquidation, appreciation", async function () {
      const depositAmounts = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Check vault realized value and share price before */
      expect((await vault.trancheState(0)).realizedValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).realizedValue).to.equal(depositAmounts[1]);
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1"));

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment
      );

      /* Withdraw the collateral */
      await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);

      /* Callback vault */
      await vault
        .connect(accountLiquidator)
        .onCollateralLiquidated(noteToken.address, loanId, ethers.utils.parseEther("3"));

      /* Check vault realized value and share price after */
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.utils.parseEther("10.005479447826171736"));
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.utils.parseEther("5.994520552173828264"));
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1.000547944782617173"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1.198904110434765652"));
      expect(await vault.redemptionSharePrice(0)).to.equal(await vault.sharePrice(0));
      expect(await vault.redemptionSharePrice(1)).to.equal(await vault.sharePrice(1));
    });
  });

  describe("share price appreciation", async function () {
    async function computeEstimatedValue(
      trancheId: number,
      pendingReturns: { [key: number]: [BigNumber, BigNumber] }
    ): Promise<BigNumber> {
      const TIME_BUCKET_DURATION = (await vault.TIME_BUCKET_DURATION()).toNumber();
      const SHARE_PRICE_PRORATION_BUCKETS = (await vault.SHARE_PRICE_PRORATION_BUCKETS()).toNumber();
      const TOTAL_SHARE_PRICE_PRORATION_DURATION = (await vault.TOTAL_SHARE_PRICE_PRORATION_DURATION()).toNumber();

      const currentTimestamp = await getBlockTimestamp();
      const currentTimeBucket = Math.floor(currentTimestamp / TIME_BUCKET_DURATION);
      const elapsedTimeIntoBucket = Math.floor(currentTimestamp - currentTimeBucket * TIME_BUCKET_DURATION);

      let proratedReturn = ethers.constants.Zero;

      for (let i = 0; i < (await vault.SHARE_PRICE_PRORATION_BUCKETS()).toNumber(); i++) {
        const elapsedTimeIntoWindow =
          elapsedTimeIntoBucket + TIME_BUCKET_DURATION * (SHARE_PRICE_PRORATION_BUCKETS - 1 - i);
        const pendingReturn = pendingReturns[currentTimeBucket + i]
          ? pendingReturns[currentTimeBucket + i][trancheId]
          : ethers.constants.Zero;

        proratedReturn = proratedReturn.add(
          FixedPoint.div(
            FixedPoint.mul(FixedPoint.from(elapsedTimeIntoWindow), pendingReturn),
            FixedPoint.from(TOTAL_SHARE_PRICE_PRORATION_DURATION)
          )
        );
      }

      return (await vault.trancheState(trancheId)).realizedValue.add(proratedReturn);
    }

    async function computeSharePrice(
      trancheId: number,
      pendingReturns: { [key: number]: [BigNumber, BigNumber] }
    ): Promise<BigNumber> {
      return FixedPoint.div(
        await computeEstimatedValue(trancheId, pendingReturns),
        trancheId === 0 ? await seniorLPToken.totalSupply() : await juniorLPToken.totalSupply()
      );
    }

    it("share price appreciation from one loan", async function () {
      const depositAmounts = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 90 * 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create and sell a loan */
      const loanId = await createAndSellLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Look up pending returns */
      const loanState = await vault.loanState(noteToken.address, loanId);
      const loanInfo = await testNoteAdapter.getLoanInfo(loanId);
      const timeBucket = loanInfo.maturity.div(await vault.TIME_BUCKET_DURATION()).toNumber();
      const pendingReturns: { [key: number]: [BigNumber, BigNumber] } = {
        [timeBucket]: [
          loanState.seniorTrancheReturn,
          loanState.repayment.sub(loanState.purchasePrice).sub(loanState.seniorTrancheReturn),
        ],
      };

      /* Check share price leading up to and after maturity */

      await elapseTime(5 * 86400);
      expect(await vault.sharePrice(0)).to.equal(await computeSharePrice(0, pendingReturns));
      expect(await vault.sharePrice(1)).to.equal(await computeSharePrice(1, pendingReturns));

      await elapseTime(30 * 86400);
      expect(await vault.sharePrice(0)).to.equal(await computeSharePrice(0, pendingReturns));
      expect(await vault.sharePrice(1)).to.equal(await computeSharePrice(1, pendingReturns));

      await elapseTime(30 * 86400);
      expect(await vault.sharePrice(0)).to.equal(await computeSharePrice(0, pendingReturns));
      expect(await vault.sharePrice(1)).to.equal(await computeSharePrice(1, pendingReturns));

      /* Past loan maturity */
      await elapseTime(40 * 86400);
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1"));
    });
    it("share price appreciation from overlapping loan maturities", async function () {
      const depositAmounts = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principals = [
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("5.0"),
        ethers.utils.parseEther("4.0"),
      ];
      const repayments = [
        ethers.utils.parseEther("2.2"),
        ethers.utils.parseEther("5.3"),
        ethers.utils.parseEther("4.4"),
      ];
      const durations = [15 * 86400, 45 * 86400, 95 * 86400];

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create and sell loans */
      const loanIds: BigNumber[] = [];
      for (let i = 0; i < principals.length; i++) {
        loanIds.push(
          await createAndSellLoan(
            lendingPlatform,
            mockLoanPriceOracle,
            vault,
            nft1,
            accountBorrower,
            accountLender,
            principals[i],
            repayments[i],
            durations[i]
          )
        );
      }

      /* Look up pending returns */
      const pendingReturns: { [key: number]: [BigNumber, BigNumber] } = await loanIds.reduce(async function (
        o,
        loanId
      ) {
        const loanState = await vault.loanState(noteToken.address, loanId);
        const loanInfo = await testNoteAdapter.getLoanInfo(loanId);
        const timeBucket = loanInfo.maturity.div(await vault.TIME_BUCKET_DURATION()).toNumber();
        return {
          ...(await o),
          [timeBucket]: [
            loanState.seniorTrancheReturn,
            loanState.repayment.sub(loanState.purchasePrice).sub(loanState.seniorTrancheReturn),
          ],
        };
      },
      {});

      /* Check share price leading up to and after maturities */

      await elapseTime(5 * 86400);
      expect(await vault.sharePrice(0)).to.equal(await computeSharePrice(0, pendingReturns));
      expect(await vault.sharePrice(1)).to.equal(await computeSharePrice(1, pendingReturns));

      await elapseTime(30 * 86400);
      expect(await vault.sharePrice(0)).to.equal(await computeSharePrice(0, pendingReturns));
      expect(await vault.sharePrice(1)).to.equal(await computeSharePrice(1, pendingReturns));

      await elapseTime(45 * 86400);
      expect(await vault.sharePrice(0)).to.equal(await computeSharePrice(0, pendingReturns));
      expect(await vault.sharePrice(1)).to.equal(await computeSharePrice(1, pendingReturns));

      /* Past loan maturities */
      await elapseTime(30 * 86400);
      expect(await vault.sharePrice(0)).to.equal(FixedPoint.from("1"));
      expect(await vault.sharePrice(1)).to.equal(FixedPoint.from("1"));
    });
  });

  describe("reserves", async function () {
    it("loan repayment restores cash reserves", async function () {
      const depositAmounts = [ethers.utils.parseEther("5"), ethers.utils.parseEther("5")];
      const redemptionAmount = ethers.utils.parseEther("1.0");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Immediately redeem */
      await vault.connect(accountDepositor).redeem(0, redemptionAmount);

      expect((await vault.balanceState()).totalReservesBalance).to.be.equal(ethers.constants.Zero);

      const principal = ethers.utils.parseEther("0.1");
      const repayment = ethers.utils.parseEther("0.4");

      /* Cycle a loan */
      await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment
      );
      expect((await vault.balanceState()).totalCashBalance).to.be.equal(ethers.utils.parseEther("8.9"));
      expect((await vault.balanceState()).totalReservesBalance).to.be.equal(ethers.utils.parseEther("0.4"));

      /* Cycle a loan */
      await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment
      );
      expect((await vault.balanceState()).totalCashBalance).to.be.equal(ethers.utils.parseEther("8.8"));
      expect((await vault.balanceState()).totalReservesBalance).to.be.equal(ethers.utils.parseEther("0.8"));

      /* Cycle a loan */
      await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment
      );
      expect((await vault.balanceState()).totalCashBalance).to.be.equal(ethers.utils.parseEther("8.91"));
      expect((await vault.balanceState()).totalReservesBalance).to.be.equal(ethers.utils.parseEther("0.99"));
    });
    it("cash reserves adjust downward after low collateral liquidation", async function () {
      const depositAmounts = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Check vault balances before */
      expect((await vault.balanceState()).totalCashBalance).to.be.equal(ethers.utils.parseEther("13.5"));
      expect((await vault.balanceState()).totalReservesBalance).to.be.equal(ethers.utils.parseEther("1.5"));

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment
      );

      /* Withdraw the collateral */
      await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);

      /* Check vault balances after, with decreased reserves */
      expect((await vault.balanceState()).totalCashBalance).to.be.equal(ethers.utils.parseEther("11.5"));
      expect((await vault.balanceState()).totalReservesBalance).to.be.equal(ethers.utils.parseEther("1.5"));
      expect((await vault.balanceState()).totalLoanBalance).to.be.equal(ethers.constants.Zero);

      /* Callback vault */
      await vault
        .connect(accountLiquidator)
        .onCollateralLiquidated(noteToken.address, loanId, ethers.utils.parseEther("1"));

      /* Check vault balances after, with decreased reserves */
      expect((await vault.balanceState()).totalCashBalance).to.be.equal(ethers.utils.parseEther("12.6"));
      expect((await vault.balanceState()).totalReservesBalance).to.be.equal(ethers.utils.parseEther("1.4"));
      expect((await vault.balanceState()).totalLoanBalance).to.be.equal(ethers.constants.Zero);
    });
  });

  describe("redemption", async function () {
    it("order is senior tranche, junior tranche, cash reserves", async function () {
      const depositAmounts = [ethers.utils.parseEther("5"), ethers.utils.parseEther("5")];
      const redemptionAmount = ethers.utils.parseEther("2.0");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Redeem */
      await vault.connect(accountDepositor).redeem(0, redemptionAmount);
      await vault.connect(accountDepositor).redeem(1, redemptionAmount);

      /* Helper functions */
      const seniorRedemptionAvailable = async (account: SignerWithAddress): Promise<BigNumber> => {
        return await seniorLPToken.redemptionAvailable(
          account.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        );
      };
      const juniorRedemptionAvailable = async (account: SignerWithAddress): Promise<BigNumber> => {
        return await juniorLPToken.redemptionAvailable(
          account.address,
          (
            await vault.trancheState(1)
          ).processedRedemptionQueue
        );
      };

      /* Check redemption / reserve balances */
      expect(await seniorRedemptionAvailable(accountDepositor)).to.equal(ethers.utils.parseEther("1.0"));
      expect(await juniorRedemptionAvailable(accountDepositor)).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalReservesBalance).to.be.equal(ethers.constants.Zero);

      /* Cycle a loan */
      await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("0.1"),
        ethers.utils.parseEther("1.0")
      );

      /* Check redemption / reserve balances */
      expect(await seniorRedemptionAvailable(accountDepositor)).to.equal(ethers.utils.parseEther("2.0"));
      expect(await juniorRedemptionAvailable(accountDepositor)).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalReservesBalance).to.be.equal(ethers.constants.Zero);

      /* Cycle a loan */
      await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("0.1"),
        ethers.utils.parseEther("0.8")
      );

      /* Check redemption / reserve balances */
      expect(await seniorRedemptionAvailable(accountDepositor)).to.equal(ethers.utils.parseEther("2.0"));
      expect(await juniorRedemptionAvailable(accountDepositor)).to.equal(ethers.utils.parseEther("0.8"));
      expect((await vault.balanceState()).totalReservesBalance).to.be.equal(ethers.constants.Zero);

      /* Cycle a loan */
      await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("0.1"),
        ethers.utils.parseEther("1.6")
      );

      /* Check redemption / reserve balances */
      expect(await seniorRedemptionAvailable(accountDepositor)).to.equal(ethers.utils.parseEther("2.0"));
      expect(await juniorRedemptionAvailable(accountDepositor)).to.equal(ethers.utils.parseEther("2.0"));
      expect((await vault.balanceState()).totalReservesBalance).to.be.equal(ethers.utils.parseEther("0.4"));
    });
  });
});
