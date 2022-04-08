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

import { expectEvent } from "./helpers/EventUtilities";
import { FixedPoint } from "./helpers/FixedPointHelpers";
import { initializeAccounts, cycleLoan, cycleLoanDefault, getBlockTimestamp, elapseTime } from "./helpers/VaultHelpers";

describe("Vault Keeper Integration", function () {
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

  describe("#checkUpkeep", async function () {
    beforeEach("deposit cash", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);
    });

    it("detects repaid loan", async function () {
      /* Check upkeep before */
      let [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(false);
      expect(performData).to.equal("0x");

      /* Cycle a loan */
      const loanId = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        false
      );

      /* Fast-forward to loan maturity time */
      await elapseTime(30 * 86400);

      /* Check upkeep after for repaid loan */
      [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(true);
      expect(performData).to.equal(
        ethers.utils.defaultAbiCoder.encode(["uint8", "address", "uint256"], [0, noteToken.address, loanId])
      );
    });
    it("detects liquidated loan", async function () {
      /* Check upkeep before */
      let [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(false);
      expect(performData).to.equal("0x");

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        false,
        true
      );

      /* Check upkeep after for liquidated loan */
      [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(true);
      expect(performData).to.equal(
        ethers.utils.defaultAbiCoder.encode(["uint8", "address", "uint256"], [1, noteToken.address, loanId])
      );
    });
    it("detects expired loan", async function () {
      /* Check upkeep before */
      let [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(false);
      expect(performData).to.equal("0x");

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        false,
        false
      );

      /* Check upkeep after for expired loan */
      [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(true);
      expect(performData).to.equal(
        ethers.utils.defaultAbiCoder.encode(["uint8", "address", "uint256"], [2, noteToken.address, loanId])
      );
    });
    it("detects repaid loan in previous time bucket", async function () {
      /* Check upkeep before */
      let [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(false);
      expect(performData).to.equal("0x");

      /* Cycle a loan */
      const loanId = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        false
      );

      /* Compute target timestamp */
      const loanInfo = await testNoteAdapter.getLoanInfo(loanId);
      const targetTimeBucket = loanInfo.maturity.div(await vault.TIME_BUCKET_DURATION()).toNumber() + 1;
      const targetTimestamp = (await vault.TIME_BUCKET_DURATION()).toNumber() * targetTimeBucket;

      /* Fast-forward to target timestamp */
      const currentTimestamp = await getBlockTimestamp();
      await elapseTime(targetTimestamp - currentTimestamp);

      /* Check upkeep after for repaid loan */
      [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(true);
      expect(performData).to.equal(
        ethers.utils.defaultAbiCoder.encode(["uint8", "address", "uint256"], [0, noteToken.address, loanId])
      );
    });
  });

  describe("#performUpkeep", async function () {
    beforeEach("deposit cash", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);
    });

    it("services repaid loan", async function () {
      /* Cycle a loan */
      const loanId = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        false
      );

      /* Fast-forward to loan maturity time */
      await elapseTime(30 * 86400);

      /* Check and perform upkeep after for repaid loan */
      const [, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      const performUpkeepTx = await vault.performUpkeep(performData);
      await expectEvent(performUpkeepTx, vault, "LoanRepaid", {
        noteToken: noteToken.address,
        loanId,
      });
    });
    it("services liquidated loan", async function () {
      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        false,
        true
      );

      /* Check and perform upkeep after for liquidated loan */
      const [, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      const performUpkeepTx = await vault.performUpkeep(performData);
      await expectEvent(performUpkeepTx, vault, "LoanLiquidated", {
        noteToken: noteToken.address,
        loanId,
      });
    });
    it("services expired loan", async function () {
      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        false,
        false
      );

      /* Check and perform upkeep after for liquidated loan */
      const [, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      const performUpkeepTx = await vault.performUpkeep(performData);
      await expectEvent(performUpkeepTx, lendingPlatform, "LoanLiquidated", {
        loanId,
      });
      await expectEvent(performUpkeepTx, vault, "LoanLiquidated", {
        noteToken: noteToken.address,
        loanId,
      });
    });
    it("fails on invalid code", async function () {
      const performData = ethers.utils.defaultAbiCoder.encode(
        ["uint8", "address", "uint256"],
        [3, noteToken.address, 123]
      );
      await expect(vault.performUpkeep(performData)).to.be.revertedWith("ParameterOutOfBounds()");
    });
  });

  describe("consecutive upkeeps", async function () {
    beforeEach("deposit cash", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);
    });

    async function elapseTimeBucket() {
      const currentTimestamp = await getBlockTimestamp();
      const targetTimeBucket = Math.floor(currentTimestamp / (await vault.TIME_BUCKET_DURATION()).toNumber()) + 1;
      const targetTimestamp = (await vault.TIME_BUCKET_DURATION()).toNumber() * targetTimeBucket;
      await elapseTime(targetTimestamp - currentTimestamp + 1);
    }

    it("handles multiple loans", async function () {
      /* Fast forward to beginning of next time bucket */
      await elapseTimeBucket();

      /* Cycle a loan (repaid) */
      const loanId1 = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        false,
        7 * 86400
      );

      /* Fast forward to beginning of next time bucket */
      await elapseTimeBucket();

      /* Cycle a loan (liquidated) */
      const loanId2 = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        false,
        true,
        2 * 86400
      );

      /* Cycle a loan (expired) */
      const loanId3 = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        false,
        false,
        2 * 86400
      );

      /* Cycle a loan (repaid) */
      const loanId4 = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        false,
        5 * 86400
      );

      let upkeepNeeded: boolean;
      let performData: string;

      /* Upkeep for repaid loan in previous time bucket */
      [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(true);
      expect(performData).to.equal(
        ethers.utils.defaultAbiCoder.encode(["uint8", "address", "uint256"], [0, noteToken.address, loanId1])
      );
      await expectEvent(await vault.performUpkeep(performData), vault, "LoanRepaid", { loanId: loanId1 });

      /* Upkeep for liquidated loan in current time bucket */
      [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(true);
      expect(performData).to.equal(
        ethers.utils.defaultAbiCoder.encode(["uint8", "address", "uint256"], [1, noteToken.address, loanId2])
      );
      await expectEvent(await vault.performUpkeep(performData), vault, "LoanLiquidated", { loanId: loanId2 });

      /* Upkeep for expired loan in current time bucket */
      [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(true);
      expect(performData).to.equal(
        ethers.utils.defaultAbiCoder.encode(["uint8", "address", "uint256"], [2, noteToken.address, loanId3])
      );
      await expectEvent(await vault.performUpkeep(performData), vault, "LoanLiquidated", { loanId: loanId3 });

      /* Upkeep for repaid loan in current time bucket */
      [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(true);
      expect(performData).to.equal(
        ethers.utils.defaultAbiCoder.encode(["uint8", "address", "uint256"], [0, noteToken.address, loanId4])
      );
      await expectEvent(await vault.performUpkeep(performData), vault, "LoanRepaid", { loanId: loanId4 });

      /* No further upkeeps */
      [upkeepNeeded, performData] = await vault.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address[]"], [[noteToken.address]])
      );
      expect(upkeepNeeded).to.equal(false);
      expect(performData).to.equal("0x");
    });
  });
});
