import { expect } from "chai";
import { ethers } from "hardhat";

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
import {
  initializeAccounts,
  createLoan,
  cycleLoan,
  cycleLoanDefault,
  randomAddress,
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
  let vault: Vault;
  let seniorLPToken: LPToken;
  let juniorLPToken: LPToken;

  /* Account references */
  let accountBorrower: SignerWithAddress;
  let accountLender1: SignerWithAddress;
  let accountLender2: SignerWithAddress;
  let accountDepositor1: SignerWithAddress;
  let accountDepositor2: SignerWithAddress;
  let accountLiquidator: SignerWithAddress;

  beforeEach("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const testERC721Factory = await ethers.getContractFactory("TestERC721");
    const testLendingPlatformFactory = await ethers.getContractFactory("TestLendingPlatform");
    const testNoteAdapterFactory = await ethers.getContractFactory("TestNoteAdapter");
    const mockLoanPriceOracleFactory = await ethers.getContractFactory("MockLoanPriceOracle");
    const vaultFactory = await ethers.getContractFactory("Vault");

    /* Deploy test token */
    tok1 = (await testERC20Factory.deploy("WETH", "WETH", ethers.utils.parseEther("1000000"))) as TestERC20;
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

    /* Deploy vault */
    vault = (await vaultFactory.deploy("Test Vault", "TEST", tok1.address, ethers.constants.AddressZero)) as Vault;
    await vault.deployed();

    /* Setup vault */
    await vault.setLoanPriceOracle(mockLoanPriceOracle.address);
    await vault.setNoteAdapter(noteToken.address, testNoteAdapter.address);
    await vault.setSeniorTrancheRate(ethers.utils.parseEther("0.05").div(365 * 86400));
    await vault.setReserveRatio(ethers.utils.parseEther("0.10"));
    await vault.setCollateralLiquidator(accounts[6].address);

    /* Get vault LP tokens */
    seniorLPToken = (await ethers.getContractAt("LPToken", await vault.lpToken(0))) as LPToken;
    juniorLPToken = (await ethers.getContractAt("LPToken", await vault.lpToken(1))) as LPToken;

    /* Setup accounts */
    accountBorrower = accounts[1];
    accountLender1 = accounts[2];
    accountLender2 = accounts[3];
    accountDepositor1 = accounts[4];
    accountDepositor2 = accounts[5];
    accountLiquidator = accounts[6];

    await initializeAccounts(
      accountBorrower,
      accountLender1,
      accountLender2,
      accountDepositor1,
      accountDepositor2,
      accountLiquidator,
      nft1,
      tok1,
      lendingPlatform,
      vault
    );
  });

  describe("initial state", async function () {
    it("getters are correct", async function () {
      expect(await vault.owner()).to.equal(accounts[0].address);
      expect(await vault.name()).to.equal("Test Vault");
      expect(await vault.currencyToken()).to.equal(tok1.address);
      expect(await vault.lpToken(0)).to.equal(seniorLPToken.address);
      expect(await vault.lpToken(1)).to.equal(juniorLPToken.address);
      expect(await vault.loanPriceOracle()).to.equal(mockLoanPriceOracle.address);
      expect(await vault.collateralLiquidator()).to.equal(accountLiquidator.address);
      expect(await vault.noteAdapters(noteToken.address)).to.equal(testNoteAdapter.address);
    });

    it("tranche states are initialized", async function () {
      for (const trancheId in [0, 1]) {
        const trancheState = await vault.trancheState(trancheId);
        expect(trancheState.depositValue).to.equal(0);
        expect(trancheState.pendingRedemptions).to.equal(0);
        expect(trancheState.redemptionQueue).to.equal(0);
        expect(trancheState.processedRedemptionQueue).to.equal(0);

        expect(await vault.sharePrice(trancheId)).to.equal(ethers.utils.parseEther("1"));
        expect(await vault.redemptionSharePrice(trancheId)).to.equal(ethers.utils.parseEther("1"));
      }

      expect((await vault.balanceState()).totalCashBalance).to.be.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalLoanBalance).to.be.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.be.equal(ethers.constants.Zero);
      expect(await vault.seniorTrancheRate()).to.be.gt(ethers.constants.Zero);
      expect(await vault.reserveRatio()).to.be.gt(ethers.constants.Zero);
      expect(await vault.cashReservesAvailable()).to.equal(ethers.constants.Zero);
      expect(await vault.utilization()).to.equal(ethers.constants.Zero);
    });
  });

  describe("#deposit", async function () {
    it("deposits into senior tranche", async function () {
      const amount = ethers.utils.parseEther("1.23");

      /* Check state before deposit */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor1.address);
      expect(await seniorLPToken.balanceOf(accountDepositor1.address)).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(0)).depositValue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(1)).depositValue).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.constants.Zero);

      /* Deposit into vault */
      const depositTx = await vault.connect(accountDepositor1).deposit(0, amount);
      await expectEvent(depositTx, tok1, "Transfer", {
        from: accountDepositor1.address,
        to: vault.address,
        value: amount,
      });
      await expectEvent(depositTx, seniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountDepositor1.address,
        value: amount,
      });
      await expectEvent(depositTx, vault, "Deposited", {
        account: accountDepositor1.address,
        trancheId: 0,
        amount: amount,
        shares: amount,
      });

      /* Check state after deposit */
      expect(await tok1.balanceOf(accountDepositor1.address)).to.equal(tokBalanceBefore.sub(amount));
      expect(await seniorLPToken.balanceOf(accountDepositor1.address)).to.equal(amount);
      expect((await vault.trancheState(0)).depositValue).to.equal(amount);
      expect((await vault.trancheState(1)).depositValue).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalCashBalance).to.equal(amount);
    });

    it("deposits into junior tranche", async function () {
      const amount = ethers.utils.parseEther("1.23");

      /* Check state before deposit */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor1.address);
      expect(await juniorLPToken.balanceOf(accountDepositor1.address)).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(0)).depositValue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(1)).depositValue).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.constants.Zero);

      /* Deposit into vault */
      const depositTx = await vault.connect(accountDepositor1).deposit(1, amount);
      await expectEvent(depositTx, tok1, "Transfer", {
        from: accountDepositor1.address,
        to: vault.address,
        value: amount,
      });
      await expectEvent(depositTx, juniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountDepositor1.address,
        value: amount,
      });
      await expectEvent(depositTx, vault, "Deposited", {
        account: accountDepositor1.address,
        trancheId: 1,
        amount: amount,
        shares: amount,
      });

      /* Check state after deposit */
      expect(await tok1.balanceOf(accountDepositor1.address)).to.equal(tokBalanceBefore.sub(amount));
      expect(await juniorLPToken.balanceOf(accountDepositor1.address)).to.equal(amount);
      expect((await vault.trancheState(0)).depositValue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(1)).depositValue).to.equal(amount);
      expect((await vault.balanceState()).totalCashBalance).to.equal(amount);
    });

    it("fails on insufficient funds", async function () {
      const amount = ethers.utils.parseEther("1001");

      await expect(vault.connect(accountDepositor1).deposit(0, amount)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance"
      );

      await expect(vault.connect(accountDepositor1).deposit(1, amount)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance"
      );
    });
  });

  describe("#depositMultiple", async function () {
    it("deposits into both tranches", async function () {
      const amount1 = ethers.utils.parseEther("1.23");
      const amount2 = ethers.utils.parseEther("2.34");

      /* Check state before deposit */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor1.address);
      expect(await seniorLPToken.balanceOf(accountDepositor1.address)).to.equal(ethers.constants.Zero);
      expect(await juniorLPToken.balanceOf(accountDepositor1.address)).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(0)).depositValue).to.equal(ethers.constants.Zero);
      expect((await vault.trancheState(1)).depositValue).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalCashBalance).to.equal(ethers.constants.Zero);

      /* Deposit into vault */
      const depositTx = await vault.connect(accountDepositor1).depositMultiple([amount1, amount2]);
      await expectEvent(depositTx, tok1, "Transfer", {
        from: accountDepositor1.address,
        to: vault.address,
        value: amount1.add(amount2),
      });
      await expectEvent(depositTx, seniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountDepositor1.address,
        value: amount1,
      });
      await expectEvent(depositTx, juniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountDepositor1.address,
        value: amount2,
      });
      await expectEvent(
        depositTx,
        vault,
        "Deposited",
        {
          account: accountDepositor1.address,
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
          account: accountDepositor1.address,
          trancheId: 1,
          amount: amount2,
          shares: amount2,
        },
        1
      );

      /* Check state after deposit */
      expect(await tok1.balanceOf(accountDepositor1.address)).to.equal(tokBalanceBefore.sub(amount1.add(amount2)));
      expect(await seniorLPToken.balanceOf(accountDepositor1.address)).to.equal(amount1);
      expect(await juniorLPToken.balanceOf(accountDepositor1.address)).to.equal(amount2);
      expect((await vault.trancheState(0)).depositValue).to.equal(amount1);
      expect((await vault.trancheState(1)).depositValue).to.equal(amount2);
      expect((await vault.balanceState()).totalCashBalance).to.equal(amount1.add(amount2));
    });
  });

  describe("#sellNote", async function () {
    it("sells note", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
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
      expect((await vault.loans(noteToken.address, loanId)).purchasePrice).to.equal(ethers.constants.Zero);

      /* Sell note to vault */
      const sellTx = await vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal);
      await expectEvent(sellTx, tok1, "Transfer", {
        from: vault.address,
        to: accountLender1.address,
        value: principal,
      });
      await expectEvent(sellTx, noteToken, "Transfer", {
        from: accountLender1.address,
        to: vault.address,
        tokenId: loanId,
      });
      await expectEvent(sellTx, vault, "NotePurchased", {
        account: accountLender1.address,
        noteToken: noteToken.address,
        tokenId: loanId,
        purchasePrice: principal,
      });

      /* Check state after sale */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(principal);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loans(noteToken.address, loanId)).collateralToken).to.equal(nft1.address);
      expect((await vault.loans(noteToken.address, loanId)).purchasePrice).to.equal(principal);
      expect((await vault.loans(noteToken.address, loanId)).repayment).to.equal(repayment);
      expect((await vault.loans(noteToken.address, loanId)).maturity).to.be.gt(ethers.constants.Zero);
      expect((await vault.loans(noteToken.address, loanId)).liquidated).to.equal(false);
    });
    it("fails on unsupported note token", async function () {
      await expect(
        vault.connect(accountLender1).sellNote(ethers.constants.AddressZero, 1, ethers.utils.parseEther("2"))
      ).to.be.revertedWith("Unsupported note token");
    });
    it("fails on unsupported note parameters", async function () {
      await mockLoanPriceOracle.setError(0 /* MockError.Unsupported */);

      await expect(
        vault.connect(accountLender1).sellNote(noteToken.address, 1, ethers.utils.parseEther("2"))
      ).to.be.revertedWith("Unsupported note parameters");
    });
    it("fails on invalid purchase price", async function () {
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(ethers.utils.parseEther("1.0"));

      await expect(vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal)).to.be.revertedWith(
        "Invalid purchase price"
      );
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
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(purchasePrice);

      await expect(vault.connect(accountLender1).sellNote(noteToken.address, loanId, purchasePrice)).to.be.revertedWith(
        "Purchase price too high"
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
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      await expect(vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal)).to.be.revertedWith(
        "Insufficient cash in vault"
      );
    });
    it("fails on low senior tranche return", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.015");
      const duration = 86400 * 100;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      await expect(vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal)).to.be.revertedWith(
        "Senior tranche return too low"
      );
    });
  });

  describe("#sellNoteAndDeposit", async function () {
    it("sells note and deposits", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
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

      /* Sell note to vault */
      const sellTx = await vault
        .connect(accountLender1)
        .sellNoteAndDeposit(noteToken.address, loanId, [
          ethers.utils.parseEther("1.0"),
          ethers.utils.parseEther("1.0"),
        ]);
      await expectEvent(sellTx, noteToken, "Transfer", {
        from: accountLender1.address,
        to: vault.address,
        tokenId: loanId,
      });
      await expectEvent(sellTx, vault, "NotePurchased", {
        account: accountLender1.address,
        noteToken: noteToken.address,
        tokenId: loanId,
        purchasePrice: principal,
      });
      await expectEvent(sellTx, seniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountLender1.address,
      });
      await expectEvent(sellTx, juniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountLender1.address,
      });

      /* Check state after sale */
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmounts[0].add(depositAmounts[1]));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(principal);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
    });
    it("fails on invalid purchase price", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await expect(
        vault
          .connect(accountLender1)
          .sellNoteAndDeposit(noteToken.address, loanId, [
            ethers.utils.parseEther("1.0"),
            ethers.utils.parseEther("1.1"),
          ])
      ).to.be.revertedWith("Invalid purchase price");
    });
  });

  describe("#sellNoteBatch", async function () {
    it("sells many notes", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loans */
      const loanId1 = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );
      const loanId2 = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan prices with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Check state before sale */
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmounts[0].add(depositAmounts[1]));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);

      /* Sell notes to vault */
      const sellTx = await vault
        .connect(accountLender1)
        .sellNoteBatch([noteToken.address, noteToken.address], [loanId1, loanId2], [principal, principal]);
      await expectEvent(
        sellTx,
        tok1,
        "Transfer",
        {
          from: vault.address,
          to: accountLender1.address,
          value: principal,
        },
        0
      );
      await expectEvent(
        sellTx,
        tok1,
        "Transfer",
        {
          from: vault.address,
          to: accountLender1.address,
          value: principal,
        },
        1
      );
      await expectEvent(
        sellTx,
        noteToken,
        "Transfer",
        {
          from: accountLender1.address,
          to: vault.address,
          tokenId: loanId1,
        },
        0
      );
      await expectEvent(
        sellTx,
        noteToken,
        "Transfer",
        {
          from: accountLender1.address,
          to: vault.address,
          tokenId: loanId2,
        },
        1
      );
      await expectEvent(
        sellTx,
        vault,
        "NotePurchased",
        {
          account: accountLender1.address,
          noteToken: noteToken.address,
          tokenId: loanId1,
          purchasePrice: principal,
        },
        0
      );
      await expectEvent(
        sellTx,
        vault,
        "NotePurchased",
        {
          account: accountLender1.address,
          noteToken: noteToken.address,
          tokenId: loanId2,
          purchasePrice: principal,
        },
        1
      );

      /* Check state after sale */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(principal.add(principal));
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
    });
    it("fails on invalid arguments", async function () {
      await expect(
        vault.connect(accountLender1).sellNoteBatch([noteToken.address, noteToken.address], [1], [1, 2])
      ).to.be.revertedWith("Invalid parameters");

      await expect(
        vault.connect(accountLender1).sellNoteBatch([noteToken.address, noteToken.address], [1, 2], [1])
      ).to.be.revertedWith("Invalid parameters");
    });
  });

  describe("#sellNoteAndDepositBatch", async function () {
    it("sells many notes and deposits proceeds", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loans */
      const loanId1 = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );
      const loanId2 = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan prices with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Check state before sale */
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmounts[0].add(depositAmounts[1]));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);

      /* Sell notes to vault */
      const sellTx = await vault.connect(accountLender1).sellNoteAndDepositBatch(
        [noteToken.address, noteToken.address],
        [loanId1, loanId2],
        [
          [ethers.utils.parseEther("0.5"), ethers.utils.parseEther("1.5")],
          [ethers.utils.parseEther("1.0"), ethers.utils.parseEther("1.0")],
        ]
      );
      await expectEvent(
        sellTx,
        noteToken,
        "Transfer",
        {
          from: accountLender1.address,
          to: vault.address,
          tokenId: loanId1,
        },
        0
      );
      await expectEvent(
        sellTx,
        noteToken,
        "Transfer",
        {
          from: accountLender1.address,
          to: vault.address,
          tokenId: loanId2,
        },
        1
      );
      await expectEvent(
        sellTx,
        vault,
        "NotePurchased",
        {
          account: accountLender1.address,
          noteToken: noteToken.address,
          tokenId: loanId1,
          purchasePrice: principal,
        },
        0
      );
      await expectEvent(
        sellTx,
        vault,
        "NotePurchased",
        {
          account: accountLender1.address,
          noteToken: noteToken.address,
          tokenId: loanId2,
          purchasePrice: principal,
        },
        1
      );
      await expectEvent(
        sellTx,
        seniorLPToken,
        "Transfer",
        {
          from: ethers.constants.Zero,
          to: accountLender1.address,
        },
        0
      );
      await expectEvent(
        sellTx,
        juniorLPToken,
        "Transfer",
        {
          from: ethers.constants.Zero,
          to: accountLender1.address,
        },
        0
      );
      await expectEvent(
        sellTx,
        seniorLPToken,
        "Transfer",
        {
          from: ethers.constants.Zero,
          to: accountLender1.address,
        },
        1
      );
      await expectEvent(
        sellTx,
        juniorLPToken,
        "Transfer",
        {
          from: ethers.constants.Zero,
          to: accountLender1.address,
        },
        1
      );

      /* Check state after sale */
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmounts[0].add(depositAmounts[1]));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(principal.add(principal));
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
    });
    it("fails on invalid arguments", async function () {
      await expect(
        vault.connect(accountLender1).sellNoteAndDepositBatch(
          [noteToken.address, noteToken.address],
          [1],
          [
            [1, 2],
            [1, 2],
          ]
        )
      ).to.be.revertedWith("Invalid parameters");

      await expect(
        vault.connect(accountLender1).sellNoteAndDepositBatch([noteToken.address, noteToken.address], [1, 2], [[1, 2]])
      ).to.be.revertedWith("Invalid parameters");
    });
  });

  describe("#redeem", async function () {
    [ethers.utils.parseEther("0.10"), ethers.constants.Zero].forEach((ratio) => {
      it(`redeems (${ethers.utils.formatEther(ratio.mul(100))}% reserve ratio)`, async function () {
        const depositAmount = ethers.utils.parseEther("1.23");
        const redemptionAmount = ethers.utils.parseEther("1.01");

        /* Check state before deposit and redemption */
        const tokBalanceBefore = await tok1.balanceOf(accountDepositor1.address);
        expect(await seniorLPToken.balanceOf(accountDepositor1.address)).to.equal(ethers.constants.Zero);
        expect((await vault.trancheState(0)).depositValue).to.equal(ethers.constants.Zero);
        expect((await vault.trancheState(0)).pendingRedemptions).to.equal(ethers.constants.Zero);
        expect((await vault.trancheState(0)).redemptionQueue).to.equal(ethers.constants.Zero);
        expect((await vault.trancheState(0)).processedRedemptionQueue).to.equal(ethers.constants.Zero);
        expect((await seniorLPToken.redemptions(accountDepositor1.address)).pending).to.equal(ethers.constants.Zero);
        expect((await seniorLPToken.redemptions(accountDepositor1.address)).withdrawn).to.equal(ethers.constants.Zero);
        expect((await seniorLPToken.redemptions(accountDepositor1.address)).redemptionQueueTarget).to.equal(
          ethers.constants.Zero
        );

        /* Set reserve ratio */
        await vault.setReserveRatio(ratio);

        /* Deposit into vault */
        await vault.connect(accountDepositor1).deposit(0, depositAmount);

        /* Redeem partial deposit */
        const redeemTx = await vault.connect(accountDepositor1).redeem(0, redemptionAmount);
        await expectEvent(redeemTx, seniorLPToken, "Transfer", {
          from: accountDepositor1.address,
          to: ethers.constants.AddressZero,
          value: redemptionAmount,
        });
        await expectEvent(redeemTx, vault, "Redeemed", {
          account: accountDepositor1.address,
          trancheId: 0,
          amount: redemptionAmount,
          shares: redemptionAmount,
        });

        const partialRedemptionAmount = ratio.mul(depositAmount).div(ethers.utils.parseEther("1"));

        /* Check state after redemption */
        expect(await tok1.balanceOf(accountDepositor1.address)).to.equal(tokBalanceBefore.sub(depositAmount));
        expect(await seniorLPToken.balanceOf(accountDepositor1.address)).to.equal(depositAmount.sub(redemptionAmount));
        expect((await vault.trancheState(0)).depositValue).to.equal(depositAmount.sub(partialRedemptionAmount));
        expect((await vault.trancheState(0)).pendingRedemptions).to.equal(
          redemptionAmount.sub(partialRedemptionAmount)
        );
        expect((await vault.trancheState(0)).redemptionQueue).to.equal(redemptionAmount);
        expect((await vault.trancheState(0)).processedRedemptionQueue).to.equal(partialRedemptionAmount);
        expect((await seniorLPToken.redemptions(accountDepositor1.address)).pending).to.equal(redemptionAmount);
        expect((await seniorLPToken.redemptions(accountDepositor1.address)).withdrawn).to.equal(ethers.constants.Zero);
        expect((await seniorLPToken.redemptions(accountDepositor1.address)).redemptionQueueTarget).to.equal(
          redemptionAmount
        );
      });
    });
    it("fails on invalid shares", async function () {
      const depositAmount = ethers.utils.parseEther("1.23");
      const redemptionAmount = ethers.utils.parseEther("2.34");

      /* Deposit into vault */
      await vault.connect(accountDepositor1).deposit(0, depositAmount);

      /* Try to redeem too much */
      await expect(vault.connect(accountDepositor1).redeem(0, redemptionAmount)).to.be.revertedWith(
        "Insufficient shares"
      );

      /* Try to redeem from wrong tranche */
      await expect(vault.connect(accountDepositor1).redeem(1, depositAmount)).to.be.revertedWith("Insufficient shares");
    });
    it("fails on outstanding redemption", async function () {
      const depositAmount = ethers.utils.parseEther("1.23");
      const redemptionAmount = ethers.utils.parseEther("1.01");

      /* Deposit into vault */
      await vault.connect(accountDepositor1).deposit(0, depositAmount);

      /* Redeem partial deposit */
      await vault.connect(accountDepositor1).redeem(0, redemptionAmount);

      /* Try to redeem remaining deposit */
      await expect(vault.connect(accountDepositor1).redeem(0, depositAmount.sub(redemptionAmount))).to.be.revertedWith(
        "Redemption in progress"
      );
    });
  });

  describe("#redeemMultiple", async function () {
    [ethers.utils.parseEther("0.10"), ethers.constants.Zero].forEach((ratio) => {
      it(`redeems from both tranches (${ethers.utils.formatEther(ratio.mul(100))}% reserve ratio)`, async function () {
        const depositAmounts: [BigNumber, BigNumber] = [
          ethers.utils.parseEther("1.23"),
          ethers.utils.parseEther("2.34"),
        ];
        const redemptionAmounts: [BigNumber, BigNumber] = [
          ethers.utils.parseEther("1.01"),
          ethers.utils.parseEther("0.82"),
        ];

        /* Set reserve ratio */
        await vault.setReserveRatio(ratio);

        /* Check state before deposit and redemption */
        const tokBalanceBefore = await tok1.balanceOf(accountDepositor1.address);
        expect(await juniorLPToken.balanceOf(accountDepositor1.address)).to.equal(ethers.constants.Zero);
        expect(await seniorLPToken.balanceOf(accountDepositor1.address)).to.equal(ethers.constants.Zero);
        expect((await vault.trancheState(0)).depositValue).to.equal(ethers.constants.Zero);
        expect((await vault.trancheState(0)).pendingRedemptions).to.equal(ethers.constants.Zero);
        expect((await vault.trancheState(0)).redemptionQueue).to.equal(ethers.constants.Zero);
        expect((await vault.trancheState(0)).processedRedemptionQueue).to.equal(ethers.constants.Zero);
        expect((await vault.trancheState(1)).depositValue).to.equal(ethers.constants.Zero);
        expect((await vault.trancheState(1)).pendingRedemptions).to.equal(ethers.constants.Zero);
        expect((await vault.trancheState(1)).redemptionQueue).to.equal(ethers.constants.Zero);
        expect((await vault.trancheState(1)).processedRedemptionQueue).to.equal(ethers.constants.Zero);
        expect((await seniorLPToken.redemptions(accountDepositor1.address)).pending).to.equal(ethers.constants.Zero);
        expect((await seniorLPToken.redemptions(accountDepositor1.address)).withdrawn).to.equal(ethers.constants.Zero);
        expect((await seniorLPToken.redemptions(accountDepositor1.address)).redemptionQueueTarget).to.equal(
          ethers.constants.Zero
        );
        expect((await juniorLPToken.redemptions(accountDepositor1.address)).pending).to.equal(ethers.constants.Zero);
        expect((await juniorLPToken.redemptions(accountDepositor1.address)).withdrawn).to.equal(ethers.constants.Zero);
        expect((await juniorLPToken.redemptions(accountDepositor1.address)).redemptionQueueTarget).to.equal(
          ethers.constants.Zero
        );

        /* Deposit into vault */
        await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

        /* Redeem partial deposit */
        const redeemTx = await vault.connect(accountDepositor1).redeemMultiple(redemptionAmounts);
        await expectEvent(redeemTx, seniorLPToken, "Transfer", {
          from: accountDepositor1.address,
          to: ethers.constants.AddressZero,
          value: redemptionAmounts[0],
        });
        await expectEvent(redeemTx, juniorLPToken, "Transfer", {
          from: accountDepositor1.address,
          to: ethers.constants.AddressZero,
          value: redemptionAmounts[1],
        });
        await expectEvent(
          redeemTx,
          vault,
          "Redeemed",
          {
            account: accountDepositor1.address,
            trancheId: 0,
            amount: redemptionAmounts[0],
            shares: redemptionAmounts[0],
          },
          0
        );
        await expectEvent(
          redeemTx,
          vault,
          "Redeemed",
          {
            account: accountDepositor1.address,
            trancheId: 1,
            amount: redemptionAmounts[1],
            shares: redemptionAmounts[1],
          },
          1
        );

        const partialRedemptionAmount1 = ratio
          .mul(depositAmounts[0].add(depositAmounts[1]))
          .div(ethers.utils.parseEther("1"));
        const partialRedemptionAmount2 = ratio
          .mul(depositAmounts[0].add(depositAmounts[1]).sub(partialRedemptionAmount1))
          .div(ethers.utils.parseEther("1"));

        /* Check state after redemption */
        expect(await tok1.balanceOf(accountDepositor1.address)).to.equal(
          tokBalanceBefore.sub(depositAmounts[0]).sub(depositAmounts[1])
        );
        expect(await seniorLPToken.balanceOf(accountDepositor1.address)).to.equal(
          depositAmounts[0].sub(redemptionAmounts[0])
        );
        expect(await juniorLPToken.balanceOf(accountDepositor1.address)).to.equal(
          depositAmounts[1].sub(redemptionAmounts[1])
        );
        expect((await vault.trancheState(0)).depositValue).to.equal(depositAmounts[0].sub(partialRedemptionAmount1));
        expect((await vault.trancheState(0)).pendingRedemptions).to.equal(
          redemptionAmounts[0].sub(partialRedemptionAmount1)
        );
        expect((await vault.trancheState(0)).redemptionQueue).to.equal(redemptionAmounts[0]);
        expect((await vault.trancheState(0)).processedRedemptionQueue).to.equal(partialRedemptionAmount1);
        expect((await vault.trancheState(1)).depositValue).to.equal(depositAmounts[1].sub(partialRedemptionAmount2));
        expect((await vault.trancheState(1)).pendingRedemptions).to.equal(
          redemptionAmounts[1].sub(partialRedemptionAmount2)
        );
        expect((await vault.trancheState(1)).redemptionQueue).to.equal(redemptionAmounts[1]);
        expect((await vault.trancheState(1)).processedRedemptionQueue).to.equal(partialRedemptionAmount2);
        expect((await seniorLPToken.redemptions(accountDepositor1.address)).pending).to.equal(redemptionAmounts[0]);
        expect((await seniorLPToken.redemptions(accountDepositor1.address)).withdrawn).to.equal(ethers.constants.Zero);
        expect((await seniorLPToken.redemptions(accountDepositor1.address)).redemptionQueueTarget).to.equal(
          redemptionAmounts[0]
        );
        expect((await juniorLPToken.redemptions(accountDepositor1.address)).pending).to.equal(redemptionAmounts[1]);
        expect((await juniorLPToken.redemptions(accountDepositor1.address)).withdrawn).to.equal(ethers.constants.Zero);
        expect((await juniorLPToken.redemptions(accountDepositor1.address)).redemptionQueueTarget).to.equal(
          redemptionAmounts[1]
        );
      });
    });
  });

  describe("#withdraw", async function () {
    it("withdraws successfully", async function () {
      const depositAmount = ethers.utils.parseEther("15.0");
      const redemptionAmount = ethers.utils.parseEther("7.5");
      const withdrawAmount = redemptionAmount;

      const partialRedemptionAmount = (await vault.reserveRatio()).mul(depositAmount).div(ethers.utils.parseEther("1"));

      /* Deposit and redeem */
      await vault.connect(accountDepositor1).deposit(0, depositAmount);
      await vault.connect(accountDepositor1).redeem(0, redemptionAmount);

      /* Check vault balances before */
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmount.sub(partialRedemptionAmount));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(partialRedemptionAmount);

      /* Cycle a loan */
      await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender1,
        ethers.utils.parseEther("10"),
        ethers.utils.parseEther("11")
      );

      /* Save token balance before */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor1.address);

      /* Check vault balances after loan */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmount.sub(redemptionAmount).add(ethers.utils.parseEther("1"))
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(redemptionAmount);

      /* Withdraw */
      const withdrawTx = await vault.connect(accountDepositor1).withdraw(0, withdrawAmount);
      await expectEvent(withdrawTx, tok1, "Transfer", {
        from: vault.address,
        to: accountDepositor1.address,
        value: withdrawAmount,
      });
      await expectEvent(withdrawTx, vault, "Withdrawn", {
        account: accountDepositor1.address,
        trancheId: 0,
        amount: withdrawAmount,
      });

      /* Check state after withdrawal */
      expect(await tok1.balanceOf(accountDepositor1.address)).to.equal(tokBalanceBefore.add(withdrawAmount));
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).pending).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmount.sub(redemptionAmount).add(ethers.utils.parseEther("1"))
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
    });
    it("immediate withdraws successfully", async function () {
      const depositAmount = ethers.utils.parseEther("15.0");
      const redemptionAmount = ethers.utils.parseEther("1.5");

      /* Deposit and redeem */
      await vault.connect(accountDepositor1).deposit(0, depositAmount);
      await vault.connect(accountDepositor1).redeem(0, redemptionAmount);

      /* Check vault balances before */
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmount.sub(redemptionAmount));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(redemptionAmount);

      /* Save token balance before */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor1.address);

      /* Withdraw immediate redemption */
      await vault.connect(accountDepositor1).withdraw(0, redemptionAmount);

      /* Check state after withdrawal */
      expect(await tok1.balanceOf(accountDepositor1.address)).to.equal(tokBalanceBefore.add(redemptionAmount));
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).pending).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmount.sub(redemptionAmount));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
    });
    it("partial withdraws successfully", async function () {
      const depositAmount = ethers.utils.parseEther("15.0");
      const redemptionAmount = ethers.utils.parseEther("7.5");
      const withdrawAmount = ethers.utils.parseEther("3.0");

      const partialRedemptionAmount = (await vault.reserveRatio()).mul(depositAmount).div(ethers.utils.parseEther("1"));

      /* Deposit and redeem */
      await vault.connect(accountDepositor1).deposit(0, depositAmount);
      await vault.connect(accountDepositor1).redeem(0, redemptionAmount);

      /* Check vault balances before */
      expect((await vault.balanceState()).totalCashBalance).to.equal(depositAmount.sub(partialRedemptionAmount));
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(partialRedemptionAmount);

      /* Cycle a loan */
      await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender1,
        ethers.utils.parseEther("10"),
        ethers.utils.parseEther("11")
      );

      /* Save token balance before next withdrawal */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor1.address);

      /* Check vault balances after loan */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmount.sub(redemptionAmount).add(ethers.utils.parseEther("1"))
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(redemptionAmount);

      /* Withdraw partial */
      await vault.connect(accountDepositor1).withdraw(0, withdrawAmount);

      /* Check state after withdrawal */
      expect(await tok1.balanceOf(accountDepositor1.address)).to.equal(tokBalanceBefore.add(withdrawAmount));
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).pending).to.equal(redemptionAmount);
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).withdrawn).to.equal(withdrawAmount);
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).redemptionQueueTarget).to.equal(
        redemptionAmount
      );
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmount.sub(redemptionAmount).add(ethers.utils.parseEther("1"))
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(redemptionAmount.sub(withdrawAmount));

      /* Withdraw the rest */
      await vault.connect(accountDepositor1).withdraw(0, redemptionAmount.sub(withdrawAmount));

      /* Check state after withdrawal */
      expect(await tok1.balanceOf(accountDepositor1.address)).to.equal(tokBalanceBefore.add(redemptionAmount));
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).pending).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmount.sub(redemptionAmount).add(ethers.utils.parseEther("1"))
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.balanceState()).totalWithdrawalBalance).to.equal(ethers.constants.Zero);
    });
    it("fails on invalid amount", async function () {
      const depositAmount = ethers.utils.parseEther("15.0");
      const redemptionAmount = ethers.utils.parseEther("7.5");
      const withdrawAmount = ethers.utils.parseEther("8.0");

      /* Deposit and redeem */
      await vault.connect(accountDepositor1).deposit(0, depositAmount);
      await vault.connect(accountDepositor1).redeem(0, redemptionAmount);

      /* Try to withdraw too much */
      await expect(vault.connect(accountDepositor1).withdraw(0, withdrawAmount)).to.be.revertedWith("Invalid amount");
    });
    it("fails on redemption not ready", async function () {
      const depositAmount = ethers.utils.parseEther("15.0");
      const redemptionAmount = ethers.utils.parseEther("7.5");
      const withdrawAmount = ethers.utils.parseEther("2.0");

      /* Deposit and redeem */
      await vault.connect(accountDepositor1).deposit(0, depositAmount);
      await vault.connect(accountDepositor1).redeem(0, redemptionAmount);

      /* Try to withdraw early */
      await expect(vault.connect(accountDepositor1).withdraw(0, withdrawAmount)).to.be.revertedWith(
        "Redemption not ready"
      );
    });
  });

  describe("#withdrawMultiple", async function () {
    it("withdraws from both tranches", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10.0"), ethers.utils.parseEther("5")];
      const redemptionAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("3"), ethers.utils.parseEther("4")];
      const withdrawAmounts: [BigNumber, BigNumber] = redemptionAmounts;

      /* Deposit and redeem */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);
      await vault.connect(accountDepositor1).redeemMultiple(redemptionAmounts);

      /* Cycle a loan */
      await cycleLoan(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender1,
        ethers.utils.parseEther("10"),
        ethers.utils.parseEther("11")
      );

      /* Save token balance before */
      const tokBalanceBefore = await tok1.balanceOf(accountDepositor1.address);

      /* Withdraw */
      const withdrawTx = await vault.connect(accountDepositor1).withdrawMultiple(withdrawAmounts);
      await expectEvent(
        withdrawTx,
        tok1,
        "Transfer",
        {
          from: vault.address,
          to: accountDepositor1.address,
          value: withdrawAmounts[0],
        },
        0
      );
      await expectEvent(
        withdrawTx,
        tok1,
        "Transfer",
        {
          from: vault.address,
          to: accountDepositor1.address,
          value: withdrawAmounts[1],
        },
        1
      );
      await expectEvent(
        withdrawTx,
        vault,
        "Withdrawn",
        {
          account: accountDepositor1.address,
          trancheId: 0,
          amount: withdrawAmounts[0],
        },
        0
      );
      await expectEvent(
        withdrawTx,
        vault,
        "Withdrawn",
        {
          account: accountDepositor1.address,
          trancheId: 1,
          amount: withdrawAmounts[1],
        },
        1
      );

      /* Check state after withdrawal */
      expect(await tok1.balanceOf(accountDepositor1.address)).to.equal(
        tokBalanceBefore.add(withdrawAmounts[0].add(withdrawAmounts[1]))
      );
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).pending).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await seniorLPToken.redemptions(accountDepositor1.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );
      expect((await juniorLPToken.redemptions(accountDepositor1.address)).pending).to.equal(ethers.constants.Zero);
      expect((await juniorLPToken.redemptions(accountDepositor1.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await juniorLPToken.redemptions(accountDepositor1.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );
    });
  });

  describe("#liquidateLoan", async function () {
    it("liquidates loan successfully", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal);

      /* Wait for loan to expire */
      await elapseTime(duration);

      /* Check state before callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(principal);
      expect((await vault.loans(noteToken.address, loanId)).liquidated).to.equal(false);
      expect((await vault.trancheState(0)).depositValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).depositValue).to.equal(depositAmounts[1]);

      /* Liquidate the loan */
      await vault.liquidateLoan(noteToken.address, loanId);

      /* Check state after callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loans(noteToken.address, loanId)).liquidated).to.equal(true);
      expect((await vault.trancheState(0)).depositValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).depositValue).to.equal(depositAmounts[1].sub(principal));
    });
    it("fails on unexpired loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal);

      await expect(vault.liquidateLoan(noteToken.address, loanId)).to.be.revertedWith("Liquidate failed");
    });
    it("fails on unknown loan", async function () {
      await expect(vault.liquidateLoan(noteToken.address, 12345)).to.be.revertedWith("Liquidate failed");
    });
    it("fails on unsupported note token", async function () {
      await expect(vault.liquidateLoan(tok1.address, 12345)).to.be.revertedWith("Unsupported note token");
    });
  });

  describe("#withdrawCollateral", async function () {
    it("withdraws collateral after liquidation", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Cycle a defaulted loan */
      const [loanId, collateralTokenId] = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment
      );

      /* Check state before withdraw */
      expect(await nft1.ownerOf(collateralTokenId)).to.equal(vault.address);

      /* Withdraw the collateral */
      const withdrawTx = await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);
      await expectEvent(withdrawTx, nft1, "Transfer", {
        from: vault.address,
        to: accountLiquidator.address,
        tokenId: collateralTokenId,
      });
      await expectEvent(withdrawTx, vault, "CollateralWithdrawn", {
        noteToken: noteToken.address,
        noteTokenId: loanId,
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
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal);

      await expect(vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId)).to.be.revertedWith(
        "Loan not liquidated"
      );
    });
    it("fails on already withdrawn collateral", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Cycle a defaulted loan */
      const [loanId] = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender1,
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
        "Unknown loan"
      );
    });
    it("fails on invalid caller", async function () {
      await expect(vault.connect(accountBorrower).withdrawCollateral(noteToken.address, 12345)).to.be.revertedWith(
        "Invalid caller"
      );
    });
  });

  describe("#onLoanRepaid", async function () {
    it("succeeds on repaid loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal);

      /* Repay loan */
      await lendingPlatform.connect(accountBorrower).repay(loanId, false);

      /* Check state before callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(principal);
      expect((await vault.loans(noteToken.address, loanId)).active).to.equal(true);
      expect((await vault.loans(noteToken.address, loanId)).purchasePrice).to.equal(principal);
      expect((await vault.trancheState(0)).depositValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).depositValue).to.equal(depositAmounts[1]);

      /* Callback vault */
      const onLoanRepaidTx = await vault.onLoanRepaid(noteToken.address, loanId);
      await expectEvent(onLoanRepaidTx, vault, "LoanRepaid", {
        noteToken: noteToken.address,
        noteTokenId: loanId,
      });

      /* Check state after callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).add(repayment.sub(principal))
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loans(noteToken.address, loanId)).active).to.equal(false);
      expect((await vault.trancheState(0)).depositValue.add((await vault.trancheState(1)).depositValue)).to.equal(
        depositAmounts[0].add(depositAmounts[1]).add(repayment.sub(principal))
      );
    });
    it("fails on unrepaid loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal);

      await expect(vault.onLoanRepaid(noteToken.address, loanId)).to.be.revertedWith("Loan not repaid");
    });
    it("fails on unknown loan", async function () {
      await expect(vault.onLoanRepaid(noteToken.address, 12345)).to.be.revertedWith("Unknown loan");
    });
    it("fails on unsupported note", async function () {
      await expect(vault.onLoanRepaid(ethers.constants.AddressZero, 12345)).to.be.revertedWith(
        "Unsupported note token"
      );
    });
    it("fails on processed loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal);

      /* Repay loan */
      await lendingPlatform.connect(accountBorrower).repay(loanId, false);

      /* Callback vault */
      await vault.onLoanRepaid(noteToken.address, loanId);

      await expect(vault.onLoanRepaid(noteToken.address, loanId)).to.be.revertedWith("Unknown loan");
    });
  });

  describe("#onLoanLiquidated", async function () {
    it("succeeds on liquidated loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal);

      /* Elapse time */
      await elapseTime(duration);

      /* Liquidate loan */
      await lendingPlatform.liquidate(loanId);

      /* Check state before callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(principal);
      expect((await vault.loans(noteToken.address, loanId)).liquidated).to.equal(false);
      expect((await vault.trancheState(0)).depositValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).depositValue).to.equal(depositAmounts[1]);

      /* Callback vault */
      const onLoanLiquidatedTx = await vault.onLoanLiquidated(noteToken.address, loanId);
      await expectEvent(onLoanLiquidatedTx, vault, "LoanLiquidated", {
        noteToken: noteToken.address,
        noteTokenId: loanId,
      });

      /* Check state after callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loans(noteToken.address, loanId)).liquidated).to.equal(true);
      expect((await vault.trancheState(0)).depositValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).depositValue).to.equal(depositAmounts[1].sub(principal));
    });
    it("fails on unliquidated loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal);

      await expect(vault.onLoanLiquidated(noteToken.address, loanId)).to.be.revertedWith("Loan not liquidated");
    });
    it("fails on unknown loan", async function () {
      await expect(vault.onLoanRepaid(noteToken.address, 12345)).to.be.revertedWith("Unknown loan");
    });
    it("fails on unsupported note", async function () {
      await expect(vault.onLoanRepaid(ethers.constants.AddressZero, 12345)).to.be.revertedWith(
        "Unsupported note token"
      );
    });
    it("fails on processed loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal);

      /* Elapse time */
      await elapseTime(duration);

      /* Liquidate loan */
      await lendingPlatform.liquidate(loanId);

      /* Callback vault */
      await vault.onLoanLiquidated(noteToken.address, loanId);

      await expect(vault.onLoanLiquidated(noteToken.address, loanId)).to.be.revertedWith("Loan liquidation processed");
    });
  });

  describe("#onCollateralLiquidated", async function () {
    it("succeeds on liquidated collateral", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Cycle a defaulted loan */
      const [loanId] = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment
      );

      /* Withdraw the collateral */
      await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);

      /* Deposit proceeds in vault */
      await tok1.connect(accountLiquidator).transfer(vault.address, repayment);

      /* Check state before callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).sub(principal)
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loans(noteToken.address, loanId)).liquidated).to.equal(true);
      expect((await vault.loans(noteToken.address, loanId)).active).to.equal(true);
      expect((await vault.trancheState(0)).depositValue).to.equal(depositAmounts[0]);
      expect((await vault.trancheState(1)).depositValue).to.equal(depositAmounts[1].sub(principal));

      /* Callback vault */
      const onCollateralLiquidatedTx = await vault
        .connect(accountLiquidator)
        .onCollateralLiquidated(noteToken.address, loanId, repayment);
      await expectEvent(onCollateralLiquidatedTx, vault, "CollateralLiquidated", {
        noteToken: noteToken.address,
        noteTokenId: loanId,
        proceeds: repayment,
      });

      /* Check state after callback */
      expect((await vault.balanceState()).totalCashBalance).to.equal(
        depositAmounts[0].add(depositAmounts[1]).add(repayment.sub(principal))
      );
      expect((await vault.balanceState()).totalLoanBalance).to.equal(ethers.constants.Zero);
      expect((await vault.loans(noteToken.address, loanId)).liquidated).to.equal(true);
      expect((await vault.loans(noteToken.address, loanId)).active).to.equal(false);
      expect((await vault.trancheState(0)).depositValue.add((await vault.trancheState(1)).depositValue)).to.equal(
        depositAmounts[0].add(depositAmounts[1]).add(repayment.sub(principal))
      );
    });
    it("fails on already liquidated loan and collateral", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Cycle a defaulted loan */
      const [loanId] = await cycleLoanDefault(
        lendingPlatform,
        mockLoanPriceOracle,
        vault,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment
      );

      /* Withdraw the collateral */
      await vault.connect(accountLiquidator).withdrawCollateral(noteToken.address, loanId);

      /* Deposit proceeds in vault */
      await tok1.connect(accountLiquidator).transfer(vault.address, repayment);

      /* Callback vault */
      await vault.connect(accountLiquidator).onCollateralLiquidated(noteToken.address, loanId, repayment);

      await expect(
        vault.connect(accountLiquidator).onCollateralLiquidated(noteToken.address, loanId, repayment)
      ).to.be.revertedWith("Unknown loan");
    });
    it("fails on unliquidated loan", async function () {
      const depositAmounts: [BigNumber, BigNumber] = [ethers.utils.parseEther("10"), ethers.utils.parseEther("5")];
      const principal = ethers.utils.parseEther("2.0");
      const repayment = ethers.utils.parseEther("2.2");
      const duration = 86400;

      /* Deposit cash */
      await vault.connect(accountDepositor1).depositMultiple(depositAmounts);

      /* Create loan */
      const loanId = await createLoan(
        lendingPlatform,
        nft1,
        accountBorrower,
        accountLender1,
        principal,
        repayment,
        duration
      );

      /* Setup loan price with mock loan price oracle */
      await mockLoanPriceOracle.setPrice(principal);

      /* Sell note to vault */
      await vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal);

      await expect(
        vault.connect(accountLiquidator).onCollateralLiquidated(noteToken.address, loanId, repayment)
      ).to.be.revertedWith("Loan not liquidated");
    });
    it("fails on unknown loan", async function () {
      await expect(
        vault
          .connect(accountLiquidator)
          .onCollateralLiquidated(noteToken.address, 12345, ethers.utils.parseEther("2.2"))
      ).to.be.revertedWith("Unknown loan");
    });
    it("fails on invalid caller", async function () {
      await expect(
        vault.connect(accountBorrower).onCollateralLiquidated(noteToken.address, 12345, ethers.utils.parseEther("2.2"))
      ).to.be.revertedWith("Invalid caller");
    });
  });

  describe("#utilization", async function () {
    [25, 50, 100].forEach((utilization) => {
      it(`achieves utilization of ${utilization}%`, async function () {
        const depositAmount = ethers.utils.parseEther("10");
        const principal = depositAmount.mul(utilization).div(100);
        const repayment = principal.mul(110).div(100);
        const duration = 86400;

        /* Disable reserves */
        await vault.setReserveRatio(ethers.constants.Zero);

        /* Deposit cash */
        await vault.connect(accountDepositor1).deposit(0, depositAmount);

        /* Create loan */
        const loanId = await createLoan(
          lendingPlatform,
          nft1,
          accountBorrower,
          accountLender1,
          principal,
          repayment,
          duration
        );

        /* Setup loan price with mock loan price oracle */
        await mockLoanPriceOracle.setPrice(principal);

        /* Sell note to vault */
        await vault.connect(accountLender1).sellNote(noteToken.address, loanId, principal);

        expect(await vault.utilization()).to.equal(
          ethers.BigNumber.from(utilization).mul(ethers.constants.WeiPerEther).div(100)
        );
      });
    });
  });

  describe("#setSeniorTrancheRate", async function () {
    it("sets senior tranche rate successfully", async function () {
      const rate = ethers.utils.parseEther("0.025").div(365 * 86400);

      const tx = await vault.setSeniorTrancheRate(rate);

      await expectEvent(tx, vault, "SeniorTrancheRateUpdated", {
        rate: rate,
      });
      expect(await vault.seniorTrancheRate()).to.equal(rate);
    });
    it("fails on invalid caller", async function () {
      const rate = ethers.utils.parseEther("0.025").div(365 * 86400);

      await expect(vault.connect(accounts[1]).setSeniorTrancheRate(rate)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });

  describe("#setReserveRatio", async function () {
    it("sets reserve ratio successfully", async function () {
      const ratio = ethers.utils.parseEther("0.15");

      const tx = await vault.setReserveRatio(ratio);

      await expectEvent(tx, vault, "ReserveRatioUpdated", {
        ratio: ratio,
      });
      expect(await vault.reserveRatio()).to.equal(ratio);
    });
    it("fails on invalid caller", async function () {
      const ratio = ethers.utils.parseEther("0.15");

      await expect(vault.connect(accounts[1]).setReserveRatio(ratio)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
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
    it("fails on invalid caller", async function () {
      const addr = randomAddress();

      await expect(vault.connect(accounts[1]).setLoanPriceOracle(addr)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });

  describe("#setCollateralLiquidator", async function () {
    it("sets collateral liquidator successfully", async function () {
      const addr = randomAddress();

      const tx = await vault.setCollateralLiquidator(addr);

      await expectEvent(tx, vault, "CollateralLiquidatorUpdated", {
        collateralLiquidator: addr,
      });
      expect(await vault.collateralLiquidator()).to.equal(addr);
    });
    it("fails on invalid caller", async function () {
      const addr = randomAddress();

      await expect(vault.connect(accounts[1]).setCollateralLiquidator(addr)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
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
    it("fails on invalid caller", async function () {
      const addr1 = randomAddress();
      const addr2 = randomAddress();

      await expect(vault.connect(accounts[1]).setNoteAdapter(addr1, addr2)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });
});
