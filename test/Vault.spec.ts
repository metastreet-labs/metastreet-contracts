import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";

import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import type { Contract } from "ethers";
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
import {
  LoanStatus,
  initializeAccounts,
  createLoan,
  createLoanAgainstMultiple,
  createAndSellLoan,
  cycleLoan,
  cycleLoanDefault,
  randomAddress,
  getBlockTimestamp,
  elapseTime,
} from "./helpers/VaultHelpers";

describe("Vault", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let nft1: TestERC721;
  let lendingPlatform: TestLendingPlatform;
  let noteToken: TestNoteToken;
  let mockLoanPriceOracle: MockLoanPriceOracle;
  let testNoteAdapter: TestNoteAdapter;
  let lpTokenBeacon: Contract;
  let vaultBeacon: Contract;
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

    /* Deploy mock loan price oracle */
    mockLoanPriceOracle = (await mockLoanPriceOracleFactory.deploy(tok1.address)) as MockLoanPriceOracle;
    await mockLoanPriceOracle.deployed();

    /* Deploy LPToken Beacon */
    lpTokenBeacon = await upgrades.deployBeacon(lpTokenFactory);
    await lpTokenBeacon.deployed();

    /* Deploy Senior LP Token */
    seniorLPToken = (await upgrades.deployBeaconProxy(lpTokenBeacon.address, lpTokenFactory, [
      "Senior LP Token",
      "msLP-TEST-WETH",
    ])) as LPToken;
    await seniorLPToken.deployed();

    /* Deploy Junior LP Token */
    juniorLPToken = (await upgrades.deployBeaconProxy(lpTokenBeacon.address, lpTokenFactory, [
      "Junior LP Token",
      "mjLP-TEST-WETH",
    ])) as LPToken;
    await juniorLPToken.deployed();

    /* Deploy vault */
    vaultBeacon = await upgrades.deployBeacon(vaultFactory, { unsafeAllow: ["delegatecall"] });
    await vaultBeacon.deployed();
    vault = (await upgrades.deployBeaconProxy(vaultBeacon.address, vaultFactory, [
      "Test Vault",
      tok1.address,
      mockLoanPriceOracle.address,
      seniorLPToken.address,
      juniorLPToken.address,
    ])) as Vault;
    await vault.deployed();

    /* Transfer ownership of LP tokens to Vault */
    await seniorLPToken.transferOwnership(vault.address);
    await juniorLPToken.transferOwnership(vault.address);

    /* Setup vault */
    await vault.setNoteAdapter(noteToken.address, testNoteAdapter.address);
    await vault.setSeniorTrancheRate(FixedPoint.normalizeRate("0.05"));
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

  describe("constants", async function () {
    it("matches implementation version", async function () {
      expect(await vault.IMPLEMENTATION_VERSION()).to.equal("1.3");
    });
  });

  describe("#initialize", async function () {
    it("fails on implementation contract", async function () {
      const vaultFactory = await ethers.getContractFactory("Vault");
      const testVault = (await vaultFactory.deploy()) as Vault;
      await testVault.deployed();

      await expect(
        testVault.initialize(
          "Test Vault",
          tok1.address,
          mockLoanPriceOracle.address,
          seniorLPToken.address,
          juniorLPToken.address
        )
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
    it("fails on invalid addresses", async function () {
      const vaultFactory = await ethers.getContractFactory("Vault");

      await expect(
        upgrades.deployBeaconProxy(vaultBeacon.address, vaultFactory, [
          "Test Vault",
          ethers.constants.AddressZero,
          mockLoanPriceOracle.address,
          seniorLPToken.address,
          juniorLPToken.address,
        ])
      ).to.be.revertedWith("InvalidAddress()");

      await expect(
        upgrades.deployBeaconProxy(vaultBeacon.address, vaultFactory, [
          "Test Vault",
          tok1.address,
          ethers.constants.AddressZero,
          seniorLPToken.address,
          juniorLPToken.address,
        ])
      ).to.be.revertedWith("InvalidAddress()");

      await expect(
        upgrades.deployBeaconProxy(vaultBeacon.address, vaultFactory, [
          "Test Vault",
          tok1.address,
          mockLoanPriceOracle.address,
          ethers.constants.AddressZero,
          juniorLPToken.address,
        ])
      ).to.be.revertedWith("InvalidAddress()");

      await expect(
        upgrades.deployBeaconProxy(vaultBeacon.address, vaultFactory, [
          "Test Vault",
          tok1.address,
          mockLoanPriceOracle.address,
          seniorLPToken.address,
          ethers.constants.AddressZero,
        ])
      ).to.be.revertedWith("InvalidAddress()");
    });
    it("fails on unsupported currency token decimals", async function () {
      const testERC20Factory = await ethers.getContractFactory("TestERC20");
      const tok2 = (await testERC20Factory.deploy("TOK2", "TOK2", 6, ethers.utils.parseEther("1000000"))) as TestERC20;
      await tok2.deployed();

      const vaultFactory = await ethers.getContractFactory("Vault");

      await expect(
        upgrades.deployBeaconProxy(vaultBeacon.address, vaultFactory, [
          "Test Vault",
          tok2.address,
          mockLoanPriceOracle.address,
          seniorLPToken.address,
          juniorLPToken.address,
        ])
      ).to.be.revertedWith("UnsupportedTokenDecimals()");
    });
  });

  describe("initial state", async function () {
    it("getters are correct", async function () {
      expect(await vault.name()).to.equal("Test Vault");
      expect(await vault.currencyToken()).to.equal(tok1.address);
      expect(await vault.lpToken(0)).to.equal(seniorLPToken.address);
      expect(await vault.lpToken(1)).to.equal(juniorLPToken.address);
      expect(await vault.loanPriceOracle()).to.equal(mockLoanPriceOracle.address);
      expect(await vault.noteAdapters(noteToken.address)).to.equal(testNoteAdapter.address);
    });

    it("roles are correct", async function () {
      expect(await vault.hasRole(await vault.DEFAULT_ADMIN_ROLE(), accounts[0].address)).to.equal(true);
      expect(await vault.hasRole(await vault.EMERGENCY_ADMIN_ROLE(), accounts[0].address)).to.equal(true);
      expect(await vault.hasRole(await vault.COLLATERAL_LIQUIDATOR_ROLE(), accountLiquidator.address)).to.equal(true);
    });

    it("tranche states are initialized", async function () {
      for (const trancheId in [0, 1]) {
        const trancheState = await vault.trancheState(trancheId);
        expect(trancheState.realizedValue).to.equal(0);
        expect(trancheState.pendingRedemptions).to.equal(0);
        expect(trancheState.redemptionQueue).to.equal(0);
        expect(trancheState.processedRedemptionQueue).to.equal(0);

        expect(await vault.sharePrice(trancheId)).to.equal(FixedPoint.from("1"));
        expect(await vault.redemptionSharePrice(trancheId)).to.equal(FixedPoint.from("1"));
      }

      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
      expect(await vault.seniorTrancheRate()).to.be.gt(ethers.constants.Zero);
      expect(await vault.adminFeeRate()).to.equal(ethers.constants.Zero);
      expect(await vault["utilization()"]()).to.equal(ethers.constants.Zero);
    });
  });

  describe("#deposit", async function () {
    it("deposits into senior tranche", async function () {
      const amount = ethers.utils.parseEther("1.23");

      /* Check state before deposit */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor.address);
      expect(await seniorLPToken.balanceOf(accountDepositor.address)).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.constants.Zero);

      /* Deposit into vault */
      const depositTx = await vault.connect(accountDepositor).deposit(0, amount);
      await expectEvent(depositTx, tok1, "Transfer", {
        from: accountDepositor.address,
        to: vault.address,
        value: amount,
      });
      await expectEvent(depositTx, seniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountDepositor.address,
        value: amount,
      });
      await expectEvent(depositTx, vault, "Deposited", {
        account: accountDepositor.address,
        trancheId: 0,
        amount: amount,
        shares: amount,
      });

      /* Check state after deposit */
      expect(await tok1.balanceOf(accountDepositor.address)).to.equal(tokBalanceBefore.sub(amount));
      expect(await seniorLPToken.balanceOf(accountDepositor.address)).to.equal(amount);
      expect((await vault.trancheState(0)).realizedValue).to.equal(amount);
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalCashBalance).to.equal(amount);
    });
    it("deposits into junior tranche", async function () {
      const amount = ethers.utils.parseEther("1.23");

      /* Check state before deposit */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor.address);
      expect(await juniorLPToken.balanceOf(accountDepositor.address)).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.constants.Zero);

      /* Deposit into vault */
      const depositTx = await vault.connect(accountDepositor).deposit(1, amount);
      await expectEvent(depositTx, tok1, "Transfer", {
        from: accountDepositor.address,
        to: vault.address,
        value: amount,
      });
      await expectEvent(depositTx, juniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountDepositor.address,
        value: amount,
      });
      await expectEvent(depositTx, vault, "Deposited", {
        account: accountDepositor.address,
        trancheId: 1,
        amount: amount,
        shares: amount,
      });

      /* Check state after deposit */
      expect(await tok1.balanceOf(accountDepositor.address)).to.equal(tokBalanceBefore.sub(amount));
      expect(await juniorLPToken.balanceOf(accountDepositor.address)).to.equal(amount);
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(1)).realizedValue).to.equal(amount);
      expect((await vault.balanceState()).totalCashBalance).to.equal(amount);
    });
    [1, 0].forEach((trancheId) => {
      it(`fails on ${trancheId === 1 ? "junior" : "senior"} tranche insolvency`, async function () {
        const depositAmount = ethers.utils.parseEther("10");
        const principal = ethers.utils.parseEther("10.0");
        const repayment = ethers.utils.parseEther("10.2");

        /* Deposit cash */
        await vault.connect(accountDepositor).deposit(trancheId, depositAmount);

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

        expect((await vault.trancheState(trancheId)).realizedValue).to.equal(ethers.constants.Zero);
        expect(await vault.sharePrice(trancheId)).to.equal(ethers.constants.Zero);
        expect(await vault.redemptionSharePrice(trancheId)).to.equal(ethers.constants.Zero);

        await expect(vault.connect(accountDepositor).deposit(trancheId, depositAmount)).to.be.revertedWith(
          `InsolventTranche(${trancheId})`
        );
      });
    });
    it("fails on insufficient funds", async function () {
      const amount = ethers.utils.parseEther("1001");

      await expect(vault.connect(accountDepositor).deposit(0, amount)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance"
      );

      await expect(vault.connect(accountDepositor).deposit(1, amount)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance"
      );
    });
    it("fails on zero amount ", async function () {
      await expect(vault.connect(accountDepositor).deposit(0, 0)).to.be.revertedWith("ParameterOutOfBounds()");
      await expect(vault.connect(accountDepositor).deposit(1, 0)).to.be.revertedWith("ParameterOutOfBounds()");
    });
  });

  describe("#deposit (multicall)", async function () {
    it("deposits into both tranches", async function () {
      const amount1 = ethers.utils.parseEther("1.23");
      const amount2 = ethers.utils.parseEther("2.34");

      /* Check state before deposit */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor.address);
      expect(await seniorLPToken.balanceOf(accountDepositor.address)).to.equal(ethers.constants.Zero);
      expect(await juniorLPToken.balanceOf(accountDepositor.address)).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.constants.Zero);

      /* Deposit into vault */
      const depositTx = await vault
        .connect(accountDepositor)
        .multicall([
          vault.interface.encodeFunctionData("deposit", [0, amount1]),
          vault.interface.encodeFunctionData("deposit", [1, amount2]),
        ]);
      await expectEvent(
        depositTx,
        tok1,
        "Transfer",
        {
          from: accountDepositor.address,
          to: vault.address,
          value: amount1,
        },
        0
      );
      await expectEvent(
        depositTx,
        tok1,
        "Transfer",
        {
          from: accountDepositor.address,
          to: vault.address,
          value: amount2,
        },
        1
      );
      await expectEvent(depositTx, seniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountDepositor.address,
        value: amount1,
      });
      await expectEvent(depositTx, juniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountDepositor.address,
        value: amount2,
      });
      await expectEvent(
        depositTx,
        vault,
        "Deposited",
        {
          account: accountDepositor.address,
          trancheId: 0,
          amount: amount1,
          shares: amount1,
        },
        0
      );
      await expectEvent(
        depositTx,
        vault,
        "Deposited",
        {
          account: accountDepositor.address,
          trancheId: 1,
          amount: amount2,
          shares: amount2,
        },
        1
      );

      /* Check state after deposit */
      expect(await tok1.balanceOf(accountDepositor.address)).to.equal(tokBalanceBefore.sub(amount1.add(amount2)));
      expect(await seniorLPToken.balanceOf(accountDepositor.address)).to.equal(amount1);
      expect(await juniorLPToken.balanceOf(accountDepositor.address)).to.equal(amount2);
      expect((await vault.trancheState(0)).realizedValue).to.equal(amount1);
      expect((await vault.trancheState(1)).realizedValue).to.equal(amount2);
      expect((await vault.balanceState()).totalCashBalance).to.equal(amount1.add(amount2));
    });
    it("fails on reverted call", async function () {
      const amount1 = ethers.utils.parseEther("1.23");
      const amount2 = ethers.utils.parseEther("2.34");

      await expect(
        vault
          .connect(accountDepositor)
          .multicall([
            vault.interface.encodeFunctionData("deposit", [0, amount1]),
            vault.interface.encodeFunctionData("redeem", [0, amount2]),
          ])
      ).to.be.reverted;
    });
    it("fails on invalid call", async function () {
      await expect(vault.connect(accountDepositor).multicall(["0xaabbccdd12345678"])).to.be.revertedWith(
        "Address: low-level delegate call failed"
      );
    });
  });

  describe("#sellNote", async function () {
    it("sells note", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Check state before sale */
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmounts[0].add(depositAmounts[1]));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loanState(noteToken.address, loanId)).purchasePrice).to.equal(ethers.constants.Zero);

      /* Sell note to vault */
      const sellTx = await vault.connect(accountLender).sellNote(noteToken.address, loanId, principal);
      await expectEvent(sellTx, tok1, "Transfer", {
        from: vault.address,
        to: accountLender.address,
        value: principal,
      });
      await expectEvent(sellTx, noteToken, "Transfer", {
        from: accountLender.address,
        to: vault.address,
        tokenId: loanId,
      });
      await expectEvent(sellTx, vault, "NotePurchased", {
        account: accountLender.address,
        noteToken: noteToken.address,
        noteTokenId: loanId,
        loanId: loanId,
        purchasePrice: principal,
      });

      /* Check state after sale */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(principal);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loanState(noteToken.address, loanId)).collateralToken).to.equal(nft1.address);
      expect((await vault.loanState(noteToken.address, loanId)).purchasePrice).to.equal(principal);
      expect((await vault.loanState(noteToken.address, loanId)).repayment).to.equal(repayment);
      expect((await vault.loanState(noteToken.address, loanId)).maturityTimeBucket).to.be.gt(ethers.constants.Zero);
      expect((await vault.loanState(noteToken.address, loanId)).status).to.equal(LoanStatus.Active);
    });
    it("sells note with multiple collateral", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create loan */
      const loanId = await createLoanAgainstMultiple(
        lendingPlatform,
        nft1,
        3,
        accountBorrower,
        accountLender,
        principal.mul(3),
        repayment.mul(3),
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      const sellTx = await vault.connect(accountLender).sellNote(noteToken.address, loanId, principal.mul(3));
      await expectEvent(sellTx, tok1, "Transfer", {
        from: vault.address,
        to: accountLender.address,
        value: principal.mul(3),
      });
      await expectEvent(sellTx, noteToken, "Transfer", {
        from: accountLender.address,
        to: vault.address,
        tokenId: loanId,
      });
      await expectEvent(sellTx, vault, "NotePurchased", {
        account: accountLender.address,
        noteToken: noteToken.address,
        noteTokenId: loanId,
        loanId: loanId,
        purchasePrice: principal.mul(3),
      });

      /* Check state after sale */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal.mul(3))
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(principal.mul(3));
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loanState(noteToken.address, loanId)).collateralToken).to.equal(nft1.address);
      expect((await vault.loanState(noteToken.address, loanId)).purchasePrice).to.equal(principal.mul(3));
      expect((await vault.loanState(noteToken.address, loanId)).repayment).to.equal(repayment.mul(3));
      expect((await vault.loanState(noteToken.address, loanId)).maturityTimeBucket).to.be.gt(ethers.constants.Zero);
      expect((await vault.loanState(noteToken.address, loanId)).status).to.equal(LoanStatus.Active);
    });
    it("fails on unsupported note token", async function () {
      await expect(
        vault.connect(accountLender).sellNote(ethers.constants.AddressZero, 1, ethers.utils.parseEther("2"))
      ).to.be.revertedWith("UnsupportedNoteToken()");
    });
    it("fails on unsupported note parameters", async function () {
      await mockLoanPriceOracle.setError(0 /* MockError.Unsupported */);

      await expect(
        vault.connect(accountLender).sellNote(noteToken.address, 1, ethers.utils.parseEther("2"))
      ).to.be.revertedWith("UnsupportedNoteParameters()");
    });
    it("fails on low purchase price", async function () {
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(ethers.utils.parseEther("1.9"));

      await expect(vault.connect(accountLender).sellNote(noteToken.address, loanId, principal)).to.be.revertedWith(
        "PurchasePriceTooLow()"
      );
    });
    it("fails on low purchase price for multiple collateral", async function () {
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Create loan */
      const loanId = await createLoanAgainstMultiple(
        lendingPlatform,
        nft1,
        3,
        accountBorrower,
        accountLender,
        principal.mul(3),
        repayment.mul(3),
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(ethers.utils.parseEther("1.9"));

      await expect(
        vault.connect(accountLender).sellNote(noteToken.address, loanId, principal.mul(3))
      ).to.be.revertedWith("PurchasePriceTooLow()");
    });
    it("fails on high purchase price", async function () {
      const purchasePrice = ethers.utils.parseEther("3.0");
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(purchasePrice);

      await expect(vault.connect(accountLender).sellNote(noteToken.address, loanId, purchasePrice)).to.be.revertedWith(
        "PurchasePriceTooHigh()"
      );
    });
    it("fails on high purchase price for multiple collateral", async function () {
      const purchasePrice = ethers.utils.parseEther("3.0");
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Create loan */
      const loanId = await createLoanAgainstMultiple(
        lendingPlatform,
        nft1,
        3,
        accountBorrower,
        accountLender,
        principal.mul(3),
        repayment.mul(3),
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(purchasePrice);

      await expect(vault.connect(accountLender).sellNote(noteToken.address, loanId, purchasePrice)).to.be.revertedWith(
        "PurchasePriceTooHigh()"
      );
    });
    it("fails on insufficient cash", async function () {
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      await expect(vault.connect(accountLender).sellNote(noteToken.address, loanId, principal)).to.be.revertedWith(
        "InsufficientCashAvailable()"
      );
    });
    it("fails on low senior tranche return", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.015");
      const duration = 86400 * 100;

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      await expect(vault.connect(accountLender).sellNote(noteToken.address, loanId, principal)).to.be.revertedWith(
        "InterestRateTooLow()"
      );
    });
  });

  describe("#sellNoteAndDeposit", async function () {
    it("sells note and deposits", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("10")];
      const principal = ethers.utils.parseEther("2.0");
      const purchasePrice = ethers.utils.parseEther("2.1");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 120 * 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(purchasePrice);

      /* Check state before sale */
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmounts[0].add(depositAmounts[1]));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);

      /* Sell note to vault */
      const sellTx = await vault
        .connect(accountLender)
        .sellNoteAndDeposit(noteToken.address, loanId, principal, [FixedPoint.from("0.75"), FixedPoint.from("0.25")]);
      await expectEvent(sellTx, noteToken, "Transfer", {
        from: accountLender.address,
        to: vault.address,
        tokenId: loanId,
      });
      await expectEvent(sellTx, vault, "NotePurchased", {
        account: accountLender.address,
        noteToken: noteToken.address,
        noteTokenId: loanId,
        loanId: loanId,
        purchasePrice,
      });
      await expectEvent(sellTx, seniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountLender.address,
        value: ethers.utils.parseEther("1.575"),
      });
      await expectEvent(sellTx, juniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountLender.address,
        value: ethers.utils.parseEther("0.525"),
      });

      /* Check state after sale */
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmounts[0].add(depositAmounts[1]));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(purchasePrice);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
    });
    it("sells note and deposits to only senior", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("10")];
      const principal = ethers.utils.parseEther("2.0");
      const purchasePrice = ethers.utils.parseEther("2.1");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 120 * 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(purchasePrice);

      /* Sell note to vault */
      const sellTx = await vault
        .connect(accountLender)
        .sellNoteAndDeposit(noteToken.address, loanId, principal, [FixedPoint.from(1), ethers.constants.Zero]);
      await expectEvent(sellTx, noteToken, "Transfer", {
        from: accountLender.address,
        to: vault.address,
        tokenId: loanId,
      });
      await expectEvent(sellTx, vault, "NotePurchased", {
        account: accountLender.address,
        noteToken: noteToken.address,
        noteTokenId: loanId,
        loanId: loanId,
        purchasePrice,
      });
      await expectEvent(sellTx, seniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountLender.address,
        value: purchasePrice,
      });
    });
    it("sells note and deposits to only junior", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("10")];
      const principal = ethers.utils.parseEther("2.0");
      const purchasePrice = ethers.utils.parseEther("2.1");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 120 * 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(purchasePrice);

      /* Sell note to vault */
      const sellTx = await vault
        .connect(accountLender)
        .sellNoteAndDeposit(noteToken.address, loanId, principal, [ethers.constants.Zero, FixedPoint.from(1)]);
      await expectEvent(sellTx, noteToken, "Transfer", {
        from: accountLender.address,
        to: vault.address,
        tokenId: loanId,
      });
      await expectEvent(sellTx, vault, "NotePurchased", {
        account: accountLender.address,
        noteToken: noteToken.address,
        noteTokenId: loanId,
        loanId: loanId,
        purchasePrice,
      });
      await expectEvent(sellTx, juniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountLender.address,
        value: purchasePrice,
      });
    });
    it("fails on low purchase price", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await expect(
        vault
          .connect(accountLender)
          .sellNoteAndDeposit(noteToken.address, loanId, ethers.utils.parseEther("2.1"), [
            FixedPoint.from("0.50"),
            FixedPoint.from("0.50"),
          ])
      ).to.be.revertedWith("PurchasePriceTooLow()");
    });
    it("fails on invalid allocation", async function () {
      await expect(
        vault
          .connect(accountLender)
          .sellNoteAndDeposit(noteToken.address, 1234, ethers.utils.parseEther("2.0"), [
            ethers.constants.Zero,
            ethers.constants.Zero,
          ])
      ).to.be.revertedWith("ParameterOutOfBounds()");

      await expect(
        vault
          .connect(accountLender)
          .sellNoteAndDeposit(noteToken.address, 1234, ethers.utils.parseEther("2.0"), [
            FixedPoint.from("0.50"),
            FixedPoint.from("0.51"),
          ])
      ).to.be.revertedWith("ParameterOutOfBounds()");
    });
  });

  describe("#redeem", async function () {
    it(`redeems`, async function () {
      const depositAmount = ethers.utils.parseEther("1.23");
      const redemptionAmount = ethers.utils.parseEther("1.01");

      /* Check state before deposit and redemption */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor.address);
      expect(await seniorLPToken.balanceOf(accountDepositor.address)).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(0)).pendingRedemptions).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(0)).redemptionQueue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(0)).processedRedemptionQueue).to.equal(ethers.constants.Zero);
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).pending).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );

      /* Deposit into vault */
      await vault.connect(accountDepositor).deposit(0, depositAmount);

      /* Redeem partial deposit */
      const redeemTx = await vault.connect(accountDepositor).redeem(0, redemptionAmount);
      await expectEvent(redeemTx, seniorLPToken, "Transfer", {
        from: accountDepositor.address,
        to: ethers.constants.AddressZero,
        value: redemptionAmount,
      });
      await expectEvent(redeemTx, vault, "Redeemed", {
        account: accountDepositor.address,
        trancheId: 0,
        amount: redemptionAmount,
        shares: redemptionAmount,
      });

      /* Check state after redemption */
      expect(await tok1.balanceOf(accountDepositor.address)).to.equal(tokBalanceBefore.sub(depositAmount));
      expect(await seniorLPToken.balanceOf(accountDepositor.address)).to.equal(depositAmount.sub(redemptionAmount));
      expect((await vault.trancheState(0)).realizedValue).to.equal(depositAmount.sub(redemptionAmount));
      expect((await vault.trancheState(0)).pendingRedemptions).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(0)).redemptionQueue).to.equal(redemptionAmount);
      expect((await vault.trancheState(0)).processedRedemptionQueue).to.equal(redemptionAmount);
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(redemptionAmount);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).pending).to.equal(redemptionAmount);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );
    });
    it("redemption scheduled after cash drained", async function () {
      const depositAmount = ethers.utils.parseEther("2.5");

      /* Deposit into vault from both accounts */
      await vault.connect(accountDepositor).deposit(0, depositAmount);
      await tok1.connect(accountLender).approve(vault.address, ethers.constants.MaxUint256);
      await vault.connect(accountLender).deposit(0, depositAmount);

      /* Sell a note using up 4 ETH of cash */
      await createAndSellLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("4.0"),
        ethers.utils.parseEther("4.4"),
        30 * 86400
      );

      /* Redeem more than remaining cash */
      await vault.connect(accountDepositor).redeem(0, ethers.utils.parseEther("1.5"));

      /* Check redemption available */
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(ethers.utils.parseEther("1.0"));

      /* Check cash balance is zero */
      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.constants.Zero);

      /* Redeem from second account */
      await vault.connect(accountLender).redeem(0, ethers.utils.parseEther("1.5"));

      /* Check redemption available for second account */
      expect(
        await seniorLPToken.redemptionAvailable(
          accountLender.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(ethers.constants.Zero);
    });
    it("redemption on insolvent tranche is delayed", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("2"), ethers.utils.parseEther("2")];
      const principal = ethers.utils.parseEther("4.0");
      const repayment = ethers.utils.parseEther("4.4");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Sell a loan */
      const loanId = await createAndSellLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        86400
      );

      /* Redeem from junior tranche */
      await vault
        .connect(accountDepositor)
        .redeem(1, FixedPoint.div(depositAmounts[1], await vault.redemptionSharePrice(1)));

      /* Redemption should not be ready yet */
      expect(
        await juniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(1)
          ).processedRedemptionQueue
        )
      ).to.equal(ethers.constants.Zero);

      /* Expire the loan and process it, wiping out the junior tranche */
      await elapseTime(86400);
      await vault.onLoanExpired(await lendingPlatform.noteToken(), loanId);

      /* Withdraw the collateral */
      await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);

      /* Callback vault */
      await vault
        .connect(accountLiquidator)
        .onCollateralLiquidated(noteToken.address, loanId, ethers.utils.parseEther("2.0"));

      /* Redemption should not be ready yet */
      expect(
        await juniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(1)
          ).processedRedemptionQueue
        )
      ).to.equal(ethers.constants.Zero);
    });
    it("immediate redemption of entire tranche succeeds", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("5"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("4");
      const repayment = ethers.utils.parseEther("5");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a defaulted loan, wiping out part of junior tranche */
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

      /* Check vault balances */
      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.utils.parseEther("6"));
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.utils.parseEther("5"));
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.utils.parseEther("1"));

      /* Redeem remaining cash from junior tranche */
      await vault
        .connect(accountDepositor)
        .redeem(1, FixedPoint.div((await vault.trancheState(1)).realizedValue, await vault.redemptionSharePrice(1)));
      expect((await juniorLPToken.redemptions(accountDepositor.address)).pending).to.equal(
        ethers.utils.parseEther("1")
      );

      /* Redemption should be ready */
      expect(
        await juniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(1)
          ).processedRedemptionQueue
        )
      ).to.equal(ethers.utils.parseEther("1"));

      /* Check vault balances */
      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.utils.parseEther("5"));
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.utils.parseEther("5"));
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.constants.Zero);
    });
    it("immediate redemption alongside insolvent tranche succeeds", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("10");
      const repayment = ethers.utils.parseEther("11");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a defaulted loan, wiping out junior tranche and part of senior tranche */
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

      /* Check vault balances */
      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.utils.parseEther("5"));
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.utils.parseEther("5"));
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.constants.Zero);

      /* Attempt to redeem from junior tranche */
      await expect(vault.connect(accountDepositor).redeem(1, ethers.constants.One)).to.be.revertedWith(
        "InsolventTranche(1)"
      );

      /* Redeem cash from senior tranche */
      await vault
        .connect(accountDepositor)
        .redeem(0, FixedPoint.div(ethers.utils.parseEther("5"), await vault.redemptionSharePrice(0)));

      /* Redemption should be ready */
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(ethers.utils.parseEther("5"));

      /* Check vault balances */
      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(0)).realizedValue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(1)).realizedValue).to.equal(ethers.constants.Zero);
    });
    it("redemptions processed from new deposit", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const redemptionAmount = ethers.utils.parseEther("2.5");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Sell a note using up all cash */
      await createAndSellLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("15.0"),
        ethers.utils.parseEther("15.15"),
        30 * 86400
      );

      /* Redeem from senior and junior tranche */
      await vault.connect(accountDepositor).redeem(0, redemptionAmount);
      await vault.connect(accountDepositor).redeem(1, redemptionAmount);

      /* Check redemption available */
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(ethers.constants.Zero);
      expect(
        await juniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(1)
          ).processedRedemptionQueue
        )
      ).to.equal(ethers.constants.Zero);

      /* Deposit from another account */
      await tok1.connect(accountLender).approve(vault.address, ethers.constants.MaxUint256);
      await vault.connect(accountLender).deposit(0, redemptionAmount.mul(2));

      /* Check redemption available */
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(redemptionAmount);
      expect(
        await juniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(redemptionAmount);
    });
    it("fails on invalid amount", async function () {
      const depositAmount = ethers.utils.parseEther("1.23");
      const redemptionAmount = ethers.utils.parseEther("2.34");

      /* Deposit into vault */
      await vault.connect(accountDepositor).deposit(0, depositAmount);

      /* Try to redeem too much */
      await expect(vault.connect(accountDepositor).redeem(0, redemptionAmount)).to.be.revertedWith(
        "InsufficientBalance()"
      );

      /* Try to redeem from wrong tranche */
      await expect(vault.connect(accountDepositor).redeem(1, depositAmount)).to.be.revertedWith(
        "InsufficientBalance()"
      );
    });
    it("fails on zero amount", async function () {
      await expect(vault.connect(accountDepositor).redeem(0, 0)).to.be.revertedWith("ParameterOutOfBounds()");

      await expect(vault.connect(accountDepositor).redeem(1, 0)).to.be.revertedWith("ParameterOutOfBounds()");
    });
    it("fails on outstanding redemption", async function () {
      const depositAmount = ethers.utils.parseEther("1.23");
      const redemptionAmount = ethers.utils.parseEther("1.01");

      /* Deposit into vault */
      await vault.connect(accountDepositor).deposit(0, depositAmount);

      /* Redeem partial deposit */
      await vault.connect(accountDepositor).redeem(0, redemptionAmount);

      /* Try to redeem remaining deposit */
      await expect(vault.connect(accountDepositor).redeem(0, depositAmount.sub(redemptionAmount))).to.be.revertedWith(
        "RedemptionInProgress()"
      );
    });
    [1, 0].forEach((trancheId) => {
      it(`fails on ${trancheId === 1 ? "junior" : "senior"} tranche insolvency`, async function () {
        const depositAmount = ethers.utils.parseEther("10");
        const principal = ethers.utils.parseEther("10.0");
        const repayment = ethers.utils.parseEther("10.2");
        const redemptionAmount = ethers.utils.parseEther("1.23");

        /* Deposit cash */
        await vault.connect(accountDepositor).deposit(trancheId, depositAmount);

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

        expect((await vault.trancheState(trancheId)).realizedValue).to.equal(ethers.constants.Zero);
        expect(await vault.sharePrice(trancheId)).to.equal(ethers.constants.Zero);
        expect(await vault.redemptionSharePrice(trancheId)).to.equal(ethers.constants.Zero);

        await expect(vault.connect(accountDepositor).redeem(trancheId, redemptionAmount)).to.be.revertedWith(
          `InsolventTranche(${trancheId})`
        );
      });
    });
  });

  describe("#withdraw", async function () {
    it("withdraws successfully", async function () {
      const depositAmount = ethers.utils.parseEther("15.0");
      const redemptionAmount = ethers.utils.parseEther("7.5");
      const withdrawAmount = redemptionAmount;
      const principal = ethers.utils.parseEther("8");
      const repayment = ethers.utils.parseEther("8.8");

      /* Deposit */
      await vault.connect(accountDepositor).deposit(0, depositAmount);

      /* Sell a note using up half cash */
      const loanId = await createAndSellLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        30 * 86400
      );

      /* Redeem */
      await vault.connect(accountDepositor).redeem(0, redemptionAmount);

      /* Check vault balances before */
      const immediateRedemptionAmount = ethers.utils.parseEther("7.0");
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(immediateRedemptionAmount);
      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalLoanBalance).to.equal(principal);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(immediateRedemptionAmount);

      /* Repay loan to make remaining redemption available */
      await lendingPlatform.connect(accountBorrower).repay(loanId, false);
      await vault.onLoanRepaid(await lendingPlatform.noteToken(), loanId);

      /* Save token balance before */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor.address);

      /* Check vault balances after loan */
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(redemptionAmount);
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmount.sub(redemptionAmount).add(repayment.sub(principal))
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(redemptionAmount);

      /* Withdraw */
      const withdrawTx = await vault.connect(accountDepositor).withdraw(0, withdrawAmount);
      await expectEvent(withdrawTx, tok1, "Transfer", {
        from: vault.address,
        to: accountDepositor.address,
        value: withdrawAmount,
      });
      await expectEvent(withdrawTx, vault, "Withdrawn", {
        account: accountDepositor.address,
        trancheId: 0,
        amount: withdrawAmount,
      });

      /* Check state after withdrawal */
      expect(await tok1.balanceOf(accountDepositor.address)).to.equal(tokBalanceBefore.add(withdrawAmount));
      expect((await seniorLPToken.redemptions(accountDepositor.address)).pending).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmount.sub(redemptionAmount).add(repayment.sub(principal))
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
    });
    it("immediate withdraws successfully", async function () {
      const depositAmount = ethers.utils.parseEther("15.0");
      const redemptionAmount = ethers.utils.parseEther("1.5");

      /* Deposit and redeem */
      await vault.connect(accountDepositor).deposit(0, depositAmount);
      await vault.connect(accountDepositor).redeem(0, redemptionAmount);

      /* Check vault balances before */
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(redemptionAmount);
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmount.sub(redemptionAmount));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(redemptionAmount);

      /* Save token balance before */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor.address);

      /* Withdraw immediate redemption */
      await vault.connect(accountDepositor).withdraw(0, redemptionAmount);

      /* Check state after withdrawal */
      expect(await tok1.balanceOf(accountDepositor.address)).to.equal(tokBalanceBefore.add(redemptionAmount));
      expect((await seniorLPToken.redemptions(accountDepositor.address)).pending).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmount.sub(redemptionAmount));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
    });
    it("partial withdraws successfully", async function () {
      const depositAmount = ethers.utils.parseEther("15.0");
      const redemptionAmount = ethers.utils.parseEther("7.5");
      const withdrawAmount = ethers.utils.parseEther("3.0");

      /* Deposit and redeem */
      await vault.connect(accountDepositor).deposit(0, depositAmount);
      await vault.connect(accountDepositor).redeem(0, redemptionAmount);

      /* Check vault balances before */
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(redemptionAmount);
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmount.sub(redemptionAmount));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(redemptionAmount);

      /* Save token balance before withdrawal */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor.address);

      /* Check vault balances after loan */
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmount.sub(redemptionAmount));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(redemptionAmount);

      /* Withdraw partial */
      await vault.connect(accountDepositor).withdraw(0, withdrawAmount);

      /* Check state after withdrawal */
      expect(await tok1.balanceOf(accountDepositor.address)).to.equal(tokBalanceBefore.add(withdrawAmount));
      expect((await seniorLPToken.redemptions(accountDepositor.address)).pending).to.equal(redemptionAmount);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).withdrawn).to.equal(withdrawAmount);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(redemptionAmount.sub(withdrawAmount));
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmount.sub(redemptionAmount));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(redemptionAmount.sub(withdrawAmount));

      /* Withdraw the rest */
      await vault.connect(accountDepositor).withdraw(0, redemptionAmount.sub(withdrawAmount));

      /* Check state after withdrawal */
      expect(await tok1.balanceOf(accountDepositor.address)).to.equal(tokBalanceBefore.add(redemptionAmount));
      expect((await seniorLPToken.redemptions(accountDepositor.address)).pending).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );
      expect(
        await seniorLPToken.redemptionAvailable(
          accountDepositor.address,
          (
            await vault.trancheState(0)
          ).processedRedemptionQueue
        )
      ).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmount.sub(redemptionAmount));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
    });
    it("withdraws maximum available", async function () {
      const depositAmount = ethers.utils.parseEther("15.0");
      const redemptionAmount = ethers.utils.parseEther("7.5");
      const principal = ethers.utils.parseEther("8");
      const repayment = ethers.utils.parseEther("8.8");

      /* Deposit */
      await vault.connect(accountDepositor).deposit(0, depositAmount);

      /* Sell note */
      const loanId = await createAndSellLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        30 * 86400
      );

      /* Redeem */
      await vault.connect(accountDepositor).redeem(0, redemptionAmount);

      /* Withdraw maximum */
      const immediateRedemptionAmount = depositAmount.sub(principal);
      const withdrawTx1 = await vault.connect(accountDepositor).withdraw(0, ethers.constants.MaxUint256);
      await expectEvent(withdrawTx1, tok1, "Transfer", {
        from: vault.address,
        to: accountDepositor.address,
        value: immediateRedemptionAmount,
      });
      await expectEvent(withdrawTx1, vault, "Withdrawn", {
        account: accountDepositor.address,
        trancheId: 0,
        amount: immediateRedemptionAmount,
      });

      /* Repay loan to make remaining redemption available */
      await lendingPlatform.connect(accountBorrower).repay(loanId, false);
      await vault.onLoanRepaid(await lendingPlatform.noteToken(), loanId);

      /* Withdraw maximum */
      const withdrawTx2 = await vault.connect(accountDepositor).withdraw(0, ethers.constants.MaxUint256);
      await expectEvent(withdrawTx2, tok1, "Transfer", {
        from: vault.address,
        to: accountDepositor.address,
        value: redemptionAmount.sub(immediateRedemptionAmount),
      });
      await expectEvent(withdrawTx2, vault, "Withdrawn", {
        account: accountDepositor.address,
        trancheId: 0,
        amount: redemptionAmount.sub(immediateRedemptionAmount),
      });
    });
    it("withdraws maximum available after several withdraws", async function () {
      const depositAmount = ethers.utils.parseEther("15.0");
      const redemptionAmount = ethers.utils.parseEther("7.5");
      const principal = ethers.utils.parseEther("8");
      const repayment = ethers.utils.parseEther("8.8");

      /* Deposit */
      await vault.connect(accountDepositor).deposit(0, depositAmount);

      /* Sell note */
      const loanId = await createAndSellLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        30 * 86400
      );

      /* Redeem from first account */
      await vault.connect(accountDepositor).redeem(0, redemptionAmount);

      /* Repay loan to make remaining redemption available */
      await lendingPlatform.connect(accountBorrower).repay(loanId, false);
      await vault.onLoanRepaid(await lendingPlatform.noteToken(), loanId);

      /* Withdraw multiple times */
      await vault.connect(accountDepositor).withdraw(0, ethers.utils.parseEther("2.0"));
      await vault.connect(accountDepositor).withdraw(0, ethers.utils.parseEther("2.0"));
      await vault.connect(accountDepositor).withdraw(0, ethers.utils.parseEther("1.5"));

      /* Final withdraw is beyond available */
      const withdrawTx = await vault.connect(accountDepositor).withdraw(0, ethers.utils.parseEther("3.0"));
      await expectEvent(withdrawTx, tok1, "Transfer", {
        from: vault.address,
        to: accountDepositor.address,
        value: ethers.utils.parseEther("2.0"),
      });
      await expectEvent(withdrawTx, vault, "Withdrawn", {
        account: accountDepositor.address,
        trancheId: 0,
        amount: ethers.utils.parseEther("2.0"),
      });
    });
    it("no-op on zero withdrawal", async function () {
      const withdrawTx = await vault.connect(accountDepositor).withdraw(0, ethers.constants.Zero);
      expect((await withdrawTx.wait()).logs.length).to.equal(1);
      await expectEvent(withdrawTx, vault, "Withdrawn", {
        account: accountDepositor.address,
        trancheId: 0,
        amount: ethers.constants.Zero,
      });
    });
  });

  describe("#withdrawCollateral", async function () {
    it("withdraws collateral after liquidation", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

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

      /* Look up collateral token id */
      const collateralTokenId = (await vault.loanState(noteToken.address, loanId)).collateralTokenId;

      /* Check state before withdraw */
      expect(await nft1.ownerOf(collateralTokenId)).to.equal(vault.address);

      /* Withdraw the collateral */
      const withdrawTx = await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);
      /* First transfer is a dummy unwrap */
      await expectEvent(
        withdrawTx,
        nft1,
        "Transfer",
        {
          from: vault.address,
          to: vault.address,
          tokenId: collateralTokenId,
        },
        0
      );
      await expectEvent(
        withdrawTx,
        nft1,
        "Transfer",
        {
          from: vault.address,
          to: accountLiquidator.address,
          tokenId: collateralTokenId,
        },
        1
      );
      await expectEvent(withdrawTx, vault, "CollateralWithdrawn", {
        noteToken: noteToken.address,
        loanId,
        collateralToken: nft1.address,
        collateralTokenId: collateralTokenId,
        collateralLiquidator: accountLiquidator.address,
      });

      /* Check state after withdraw */
      expect(await nft1.ownerOf(collateralTokenId)).to.equal(accountLiquidator.address);
    });
    it("fails on unliquidated loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender).sellNote(noteToken.address, loanId, principal);

      await expect(vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId)).to.be.revertedWith(
        "InvalidLoanStatus()"
      );
    });
    it("fails on already withdrawn collateral", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

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

      await expect(vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId)).to.be.revertedWith(
        "ERC721: transfer caller is not owner nor approved"
      );
    });
    it("fails on unknown loan", async function () {
      await expect(vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, 12345)).to.be.revertedWith(
        "InvalidLoanStatus()"
      );
    });
    it("fails on invalid caller", async function () {
      await expect(vault.connect(accountBorrower).withdrawCollateral(noteToken.address, 12345)).to.be.revertedWith(
        "AccessControl: account"
      );
    });
  });

  describe("#onLoanRepaid", async function () {
    it("succeeds on repaid loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create and sell loan */
      const loanId = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        false
      );

      /* Check state before callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(principal);
      expect((await vault.loanState(noteToken.address, loanId)).status).to.equal(LoanStatus.Active);
      expect((await vault.loanState(noteToken.address, loanId)).purchasePrice).to.equal(principal);
      expect((await vault.trancheState(0)).realizedValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).realizedValue).to.equal(depositAmounts[1]);

      /* Callback vault */
      const onLoanRepaidTx = await vault.onLoanRepaid(noteToken.address, loanId);
      await expectEvent(onLoanRepaidTx, vault, "LoanRepaid", {
        noteToken: noteToken.address,
        loanId,
      });

      /* Check state after callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).add(repayment.sub(principal))
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loanState(noteToken.address, loanId)).status).to.equal(LoanStatus.Complete);
      expect((await vault.trancheState(0)).realizedValue.add((await vault.trancheState(1)).realizedValue)).to.equal(
        depositAmounts[0].add(depositAmounts[1]).add(repayment.sub(principal))
      );
    });
    it("fails on unrepaid loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender).sellNote(noteToken.address, loanId, principal);

      await expect(vault.onLoanRepaid(noteToken.address, loanId)).to.be.revertedWith("LoanNotRepaid()");
    });
    it("fails on repaid loan with callback processed", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a loan */
      const loanId = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        true
      );

      await expect(vault.onLoanRepaid(noteToken.address, loanId)).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on liquidated loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        false
      );

      await expect(vault.onLoanRepaid(noteToken.address, loanId)).to.be.revertedWith("LoanNotRepaid()");
    });
    it("fails on liquidated loan with callback processed", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        true
      );

      await expect(vault.onLoanRepaid(noteToken.address, loanId)).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on liquidated loan with callback processed and collateral withdrawn", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        true
      );

      /* Withdraw the collateral */
      await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);

      await expect(vault.onLoanRepaid(noteToken.address, loanId)).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on liquidated collateral with callback processed", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        true
      );

      /* Withdraw the collateral */
      await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);

      /* Callback vault */
      await vault.connect(accountLiquidator).onCollateralLiquidated(noteToken.address, loanId, repayment);

      await expect(vault.onLoanRepaid(noteToken.address, loanId)).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on unknown loan", async function () {
      await expect(vault.onLoanRepaid(noteToken.address, 12345)).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on unsupported note", async function () {
      await expect(vault.onLoanRepaid(ethers.constants.AddressZero, 12345)).to.be.revertedWith(
        "UnsupportedNoteToken()"
      );
    });
  });

  describe("#onLoanExpired", async function () {
    it("succeeds on expired loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender).sellNote(noteToken.address, loanId, principal);

      /* Elapse time */
      await elapseTime(duration);

      /* Check state before callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(principal);
      expect((await vault.loanState(noteToken.address, loanId)).status).to.equal(LoanStatus.Active);
      expect((await vault.trancheState(0)).realizedValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).realizedValue).to.equal(depositAmounts[1]);

      /* Callback vault */
      const onLoanExpiredTx = await vault.onLoanExpired(noteToken.address, loanId);
      await expectEvent(onLoanExpiredTx, vault, "LoanLiquidated", {
        noteToken: noteToken.address,
        loanId,
      });

      /* Check state after callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loanState(noteToken.address, loanId)).status).to.equal(LoanStatus.Liquidated);
      expect((await vault.trancheState(0)).realizedValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).realizedValue).to.equal(depositAmounts[1].sub(principal));
    });
    it("fails on repaid loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a loan */
      const loanId = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        false
      );

      await expect(vault.onLoanExpired(noteToken.address, loanId)).to.be.revertedWith("LoanNotExpired()");
    });
    it("fails on repaid loan with callback processed", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a loan */
      const loanId = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        true
      );

      await expect(vault.onLoanExpired(noteToken.address, loanId)).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on liquidated loan with callback processed", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        true
      );

      await expect(vault.onLoanExpired(noteToken.address, loanId)).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on liquidated loan with callback processed and collateral withdrawn", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        true
      );

      /* Withdraw the collateral */
      await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);

      await expect(vault.onLoanExpired(noteToken.address, loanId)).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on liquidated collateral with callback processed", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a defaulted loan */
      const loanId = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        true
      );

      /* Withdraw the collateral */
      await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);

      /* Callback vault */
      await vault.connect(accountLiquidator).onCollateralLiquidated(noteToken.address, loanId, repayment);

      await expect(vault.onLoanExpired(noteToken.address, loanId)).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on unknown loan", async function () {
      await expect(vault.onLoanRepaid(noteToken.address, 12345)).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on unsupported note", async function () {
      await expect(vault.onLoanRepaid(ethers.constants.AddressZero, 12345)).to.be.revertedWith(
        "UnsupportedNoteToken()"
      );
    });
  });

  describe("#onCollateralLiquidated", async function () {
    it("succeeds on liquidated loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

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

      /* Check state before callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loanState(noteToken.address, loanId)).status).to.equal(LoanStatus.Liquidated);
      expect((await vault.trancheState(0)).realizedValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).realizedValue).to.equal(depositAmounts[1].sub(principal));

      /* Callback vault */
      const onCollateralLiquidatedTx = await vault
        .connect(accountLiquidator)
        .onCollateralLiquidated(noteToken.address, loanId, repayment);
      await expectEvent(onCollateralLiquidatedTx, tok1, "Transfer", {
        to: vault.address,
        from: accountLiquidator.address,
        value: repayment,
      });
      await expectEvent(onCollateralLiquidatedTx, vault, "CollateralLiquidated", {
        noteToken: noteToken.address,
        loanId,
      });

      /* Check state after callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).add(repayment.sub(principal))
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loanState(noteToken.address, loanId)).status).to.equal(LoanStatus.Complete);
      expect((await vault.trancheState(0)).realizedValue.add((await vault.trancheState(1)).realizedValue)).to.equal(
        depositAmounts[0].add(depositAmounts[1]).add(repayment.sub(principal))
      );
    });
    it("fails on unliquidated loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender).sellNote(noteToken.address, loanId, principal);

      await expect(
        vault.connect(accountLiquidator).onCollateralLiquidated(noteToken.address, loanId, repayment)
      ).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on repaid loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a loan */
      const loanId = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        false
      );

      await expect(
        vault.connect(accountLiquidator).onCollateralLiquidated(noteToken.address, loanId, repayment)
      ).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on repaid loan with callback processed", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a loan */
      const loanId = await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        principal,
        repayment,
        true
      );

      await expect(
        vault.connect(accountLiquidator).onCollateralLiquidated(noteToken.address, loanId, repayment)
      ).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on liquidated collateral with callback processed", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

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
      await vault.connect(accountLiquidator).onCollateralLiquidated(noteToken.address, loanId, repayment);

      await expect(
        vault.connect(accountLiquidator).onCollateralLiquidated(noteToken.address, loanId, repayment)
      ).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on unknown loan", async function () {
      await expect(
        vault
          .connect(accountLiquidator)
          .onCollateralLiquidated(noteToken.address, 12345, ethers.utils.parseEther("2.2"))
      ).to.be.revertedWith("InvalidLoanStatus()");
    });
    it("fails on invalid caller", async function () {
      await expect(
        vault.connect(accountBorrower).onCollateralLiquidated(noteToken.address, 12345, ethers.utils.parseEther("2.2"))
      ).to.be.revertedWith("AccessControl: account");
    });
  });

  describe("#utilization", async function () {
    [25, 50, 100].forEach((utilization) => {
      it(`achieves utilization of ${utilization}%`, async function () {
        const depositAmount = ethers.utils.parseEther("10");
        const principal = depositAmount.mul(utilization).div(100);
        const repayment = principal.mul(110).div(100);
        const duration = 86400;

        /* Deposit cash */
        await vault.connect(accountDepositor).deposit(0, depositAmount);

        /* Create loan */
        const loanId = await createLoan(
          lendingPlatform,
          nft1,
          accountBorrower,
          accountLender,
          principal,
          repayment,
          duration
        );

        /* Setup loan price with mock loan price oracle */
        await mockLoanPriceOracle.setPrice(principal);

        /* Sell note to vault */
        await vault.connect(accountLender).sellNote(noteToken.address, loanId, principal);

        expect(await vault["utilization()"]()).to.equal(FixedPoint.from(utilization).div(100));
      });
    });
    it(`returns correct utilization with added loan balance`, async function () {
      await vault.connect(accountDepositor).deposit(0, ethers.utils.parseEther("10"));
      expect(await vault["utilization()"]()).to.equal(ethers.constants.Zero);
      expect(await vault["utilization(uint256)"](ethers.utils.parseEther("2.5"))).to.equal(
        ethers.utils.parseEther("0.25")
      );
    });
  });

  describe("#pendingLoans", async function () {
    async function elapseTimeBucket() {
      const currentTimestamp = await getBlockTimestamp();
      const targetTimeBucket = Math.floor(currentTimestamp / (await vault.TIME_BUCKET_DURATION()).toNumber()) + 1;
      const targetTimestamp = (await vault.TIME_BUCKET_DURATION()).toNumber() * targetTimeBucket;
      await elapseTime(targetTimestamp - currentTimestamp + 1);
    }

    it("returns loans pending across two time buckets", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Fast forward to beginning of next time bucket */
      await elapseTimeBucket();

      const loanId1 = await createAndSellLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        2 * 86400
      );

      const loanId2 = await createAndSellLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        3 * 86400
      );

      /* Fast forward to beginning of next time bucket */
      await elapseTimeBucket();

      const loanId3 = await createAndSellLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("2.0"),
        ethers.utils.parseEther("2.2"),
        3 * 86400
      );

      /* Get current time bucket */
      const currentTimeBucket = Math.floor(
        (await getBlockTimestamp()) / (await vault.TIME_BUCKET_DURATION()).toNumber()
      );

      /* Check pending loans of previous time bucket */
      expect(await vault.pendingLoans(currentTimeBucket - 1, noteToken.address)).to.deep.equal([loanId1, loanId2]);

      /* Check pending loans of current time bucket */
      expect(await vault.pendingLoans(currentTimeBucket, noteToken.address)).to.deep.equal([loanId3]);

      /* Check pending loans of future time bucket */
      expect(await vault.pendingLoans(currentTimeBucket + 1, noteToken.address)).to.deep.equal([]);
    });
  });

  describe("#withdrawAdminFees", async function () {
    it("withdraws admin fees successfully", async function () {
      const depositAmounts = [ethers.utils.parseEther("10"), ethers.utils.parseEther("10")];

      /* Set admin fee rate */
      await vault.setAdminFeeRate(FixedPoint.normalizeRate("0.10"));

      /* Deposit cash */
      await vault.connect(accountDepositor).deposit(0, depositAmounts[0]);
      await vault.connect(accountDepositor).deposit(1, depositAmounts[1]);

      /* Cycle a loan */
      await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender,
        ethers.utils.parseEther("10.0"),
        ethers.utils.parseEther("10.5")
      );

      const adminFeeBalance = (await vault.balanceState()).totalAdminFeeBalance;

      /* Save token balance before */
      const tokBalanceBefore = await tok1.balanceOf(accounts[0].address);

      /* Withdraw admin fees */
      const withdrawAdminFeeTx = await vault.withdrawAdminFees(accounts[0].address, adminFeeBalance);
      await expectEvent(withdrawAdminFeeTx, tok1, "Transfer", {
        from: vault.address,
        to: accounts[0].address,
        value: adminFeeBalance,
      });
      await expectEvent(withdrawAdminFeeTx, vault, "AdminFeesWithdrawn", {
        account: accounts[0].address,
        amount: adminFeeBalance,
      });

      /* Check state after withdraw */
      expect((await vault.balanceState()).totalAdminFeeBalance).to.equal(ethers.constants.Zero);
      expect((await tok1.balanceOf(accounts[0].address)).sub(tokBalanceBefore)).to.equal(adminFeeBalance);
    });
    it("fails on invalid address", async function () {
      await expect(
        vault.withdrawAdminFees(ethers.constants.AddressZero, ethers.utils.parseEther("1"))
      ).to.be.revertedWith("InvalidAddress()");
    });
    it("fails on invalid amount", async function () {
      await expect(vault.withdrawAdminFees(accounts[0].address, ethers.utils.parseEther("1"))).to.be.revertedWith(
        "ParameterOutOfBounds()"
      );
    });
    it("fails on invalid caller", async function () {
      await expect(
        vault.connect(accountDepositor).withdrawAdminFees(accountDepositor.address, ethers.utils.parseEther("1"))
      ).to.be.revertedWith("AccessControl: account");
    });
  });

  describe("#setSeniorTrancheRate", async function () {
    it("sets senior tranche rate successfully", async function () {
      const rate = FixedPoint.normalizeRate("0.025");

      const tx = await vault.setSeniorTrancheRate(rate);

      await expectEvent(tx, vault, "SeniorTrancheRateUpdated", {
        rate: rate,
      });
      expect(await vault.seniorTrancheRate()).to.equal(rate);
    });
    it("fails on invalid value", async function () {
      await expect(vault.setSeniorTrancheRate(ethers.constants.Zero)).to.be.revertedWith("ParameterOutOfBounds()");
      await expect(vault.setSeniorTrancheRate(FixedPoint.from("1.0"))).to.be.revertedWith("ParameterOutOfBounds()");
    });
    it("fails on invalid caller", async function () {
      const rate = FixedPoint.normalizeRate("0.025");

      await expect(vault.connect(accounts[1]).setSeniorTrancheRate(rate)).to.be.revertedWith("AccessControl: account");
    });
  });

  describe("#setAdminFeeRate", async function () {
    it("sets admin fee rate successfully", async function () {
      const rate = FixedPoint.normalizeRate("0.05");

      const tx = await vault.setAdminFeeRate(rate);

      await expectEvent(tx, vault, "AdminFeeRateUpdated", {
        rate: rate,
      });
      expect(await vault.adminFeeRate()).to.equal(rate);
    });
    it("fails on invalid value", async function () {
      await expect(vault.setAdminFeeRate(ethers.constants.Zero)).to.be.revertedWith("ParameterOutOfBounds()");
      await expect(vault.setAdminFeeRate(FixedPoint.from("1.0"))).to.be.revertedWith("ParameterOutOfBounds()");
    });
    it("fails on invalid caller", async function () {
      const rate = FixedPoint.normalizeRate("0.05");

      await expect(vault.connect(accounts[1]).setAdminFeeRate(rate)).to.be.revertedWith("AccessControl: account");
    });
  });

  describe("#setLoanPriceOracle", async function () {
    it("sets loan price oracle successfully", async function () {
      const addr = randomAddress();

      const tx = await vault.setLoanPriceOracle(addr);

      await expectEvent(tx, vault, "LoanPriceOracleUpdated", {
        loanPriceOracle: addr,
      });
      expect(await vault.loanPriceOracle()).to.equal(addr);
    });
    it("fails on invalid address", async function () {
      await expect(vault.setLoanPriceOracle(ethers.constants.AddressZero)).to.be.revertedWith("InvalidAddress()");
    });
    it("fails on invalid caller", async function () {
      const addr = randomAddress();

      await expect(vault.connect(accounts[1]).setLoanPriceOracle(addr)).to.be.revertedWith("AccessControl: account");
    });
  });

  describe("#setNoteAdapter", async function () {
    it("sets note adapter successfully", async function () {
      const addr1 = randomAddress();
      const addr2 = randomAddress();

      const tx = await vault.setNoteAdapter(addr1, addr2);

      await expectEvent(tx, vault, "NoteAdapterUpdated", {
        noteToken: addr1,
        noteAdapter: addr2,
      });
      expect(await vault.noteAdapters(addr1)).to.equal(addr2);
    });
    it("set multiple note adapters successfully", async function () {
      const noteTokens = [randomAddress(), randomAddress(), randomAddress()];
      const noteAdapters = [randomAddress(), randomAddress(), randomAddress()];

      await vault.setNoteAdapter(noteTokens[0], noteAdapters[0]);
      await vault.setNoteAdapter(noteTokens[1], noteAdapters[1]);
      await vault.setNoteAdapter(noteTokens[2], noteAdapters[2]);

      expect(await vault.noteAdapters(noteTokens[0])).to.equal(noteAdapters[0]);
      expect(await vault.noteAdapters(noteTokens[1])).to.equal(noteAdapters[1]);
      expect(await vault.noteAdapters(noteTokens[2])).to.equal(noteAdapters[2]);
      expect([...(await vault.supportedNoteTokens())].sort()).to.deep.equal([...noteTokens, noteToken.address].sort());

      /* Remove note token 1 */
      await vault.setNoteAdapter(noteTokens[1], ethers.constants.AddressZero);

      expect(await vault.noteAdapters(noteTokens[1])).to.equal(ethers.constants.AddressZero);
      expect([...(await vault.supportedNoteTokens())].sort()).to.deep.equal(
        [noteTokens[0], noteTokens[2], noteToken.address].sort()
      );
    });
    it("fails on invalid address", async function () {
      await expect(vault.setNoteAdapter(ethers.constants.AddressZero, randomAddress())).to.be.revertedWith(
        "InvalidAddress()"
      );
    });
    it("fails on invalid caller", async function () {
      const addr1 = randomAddress();
      const addr2 = randomAddress();

      await expect(vault.connect(accounts[1]).setNoteAdapter(addr1, addr2)).to.be.revertedWith(
        "AccessControl: account"
      );
    });
  });

  describe("#pause/unpause", async function () {
    it("pauses and unpauses", async function () {
      expect(await vault.paused()).to.equal(false);

      await vault.pause();
      expect(await vault.paused()).to.equal(true);

      await vault.unpause();
      expect(await vault.paused()).to.equal(false);
    });
    it("deposit fails when paused", async function () {
      await vault.pause();

      await expect(vault.connect(accountDepositor).deposit(0, ethers.utils.parseEther("1.23"))).to.be.revertedWith(
        "Pausable: paused"
      );
    });
    it("sell note fails when paused", async function () {
      await vault.pause();

      await expect(
        vault.connect(accountLender).sellNote(noteToken.address, 12345, ethers.utils.parseEther("100"))
      ).to.be.revertedWith("Pausable: paused");
    });
    it("sell note and deposit fails when paused", async function () {
      await vault.pause();

      await expect(
        vault
          .connect(accountLender)
          .sellNoteAndDeposit(noteToken.address, 12345, ethers.utils.parseEther("2.0"), [
            FixedPoint.from("0.50"),
            FixedPoint.from("0.50"),
          ])
      ).to.be.revertedWith("Pausable: paused");
    });
    it("redeem fails when paused", async function () {
      await vault.pause();

      await expect(vault.connect(accountDepositor).redeem(0, ethers.utils.parseEther("1.23"))).to.be.revertedWith(
        "Pausable: paused"
      );
    });
    it("withdraw fails when paused", async function () {
      await vault.pause();

      await expect(vault.connect(accountDepositor).withdraw(0, ethers.utils.parseEther("1.23"))).to.be.revertedWith(
        "Pausable: paused"
      );
    });
    it("fails on invalid caller", async function () {
      await vault.revokeRole(await vault.EMERGENCY_ADMIN_ROLE(), accounts[0].address);
      await vault.grantRole(await vault.EMERGENCY_ADMIN_ROLE(), randomAddress());

      await expect(vault.pause()).to.be.revertedWith("AccessControl: account");
      await expect(vault.unpause()).to.be.revertedWith("AccessControl: account");
    });
  });

  describe("#supportsInterface", async function () {
    it("returns true on supported interfaces", async function () {
      /* ERC165 */
      expect(await vault.supportsInterface(vault.interface.getSighash("supportsInterface"))).to.equal(true);
      /* AccessControl */
      expect(
        await vault.supportsInterface(
          ethers.utils.hexlify(
            [
              vault.interface.getSighash("hasRole"),
              vault.interface.getSighash("getRoleAdmin"),
              vault.interface.getSighash("grantRole"),
              vault.interface.getSighash("revokeRole"),
              vault.interface.getSighash("renounceRole"),
            ].reduce((acc, value) => acc.xor(ethers.BigNumber.from(value)), ethers.constants.Zero)
          )
        )
      ).to.equal(true);
      /* ERC721 */
      expect(await vault.supportsInterface(vault.interface.getSighash("onERC721Received"))).to.equal(true);
      /* ILoanReceiver */
      expect(
        await vault.supportsInterface(
          ethers.utils.hexlify(
            ethers.BigNumber.from(vault.interface.getSighash("onLoanRepaid")).xor(
              ethers.BigNumber.from(vault.interface.getSighash("onLoanExpired"))
            )
          )
        )
      ).to.equal(true);
      /* KeeperCompatibleInterface */
      expect(
        await vault.supportsInterface(
          ethers.utils.hexlify(
            ethers.BigNumber.from(vault.interface.getSighash("checkUpkeep")).xor(
              ethers.BigNumber.from(vault.interface.getSighash("performUpkeep"))
            )
          )
        )
      ).to.equal(true);
    });
    it("returns false on unsupported interfaces", async function () {
      expect(await vault.supportsInterface("0xaabbccdd")).to.equal(false);
      expect(await vault.supportsInterface("0x00000000")).to.equal(false);
      expect(await vault.supportsInterface("0xffffffff")).to.equal(false);
    });
  });
});
