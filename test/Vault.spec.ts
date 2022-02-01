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

  describe("initial state", async function () {
    it("getters are correct", async function () {
      expect(await vault.owner()).to.equal(accounts[0].address);
      expect(await vault.currencyToken()).to.equal(tok1.address);
      expect(await vault.loanPriceOracle()).to.equal(ethers.constants.AddressZero);
      expect(await vault.collateralLiquidator()).to.equal(ethers.constants.AddressZero);

      expect(await seniorLPToken.symbol()).to.equal("msLP-TEST-TOK1");
      expect(await juniorLPToken.symbol()).to.equal("mjLP-TEST-TOK1");
    });

    it("tranche states are initialized", async function () {
      for (const trancheId in [0, 1]) {
        const trancheState = await vault.trancheState(trancheId);
        expect(trancheState.depositValue).to.equal(0);
        expect(trancheState.pendingRedemptions).to.equal(0);
        expect(trancheState.redemptionQueue).to.equal(0);
        expect(trancheState.processedRedemptionQueue).to.equal(0);

        expect(await vault.sharePrice(trancheId)).to.equal(ethers.utils.parseEther("1"));
      }
    });
  });

  describe("#deposit", async function () {
    it("deposits into senior tranche", async function () {
      const depositor = accounts[1];
      const amount = ethers.utils.parseEther("1.23");

      /* Transfer 1.23 TOK1 to depositor account */
      await tok1.transfer(depositor.address, amount);
      /* Approve vault for transfer */
      await tok1.connect(depositor).approve(vault.address, ethers.constants.MaxUint256);

      /* Check token balances before deposit */
      expect(await tok1.balanceOf(depositor.address)).to.equal(amount);
      expect(await seniorLPToken.balanceOf(depositor.address)).to.equal(ethers.constants.Zero);

      /* Deposit into vault */
      const depositTx = await vault.connect(depositor).deposit(0, amount);
      await expectEvent(depositTx, tok1.address, tok1, "Transfer", {
        from: depositor.address,
        to: vault.address,
        value: amount,
      });
      await expectEvent(depositTx, seniorLPToken.address, seniorLPToken, "Transfer", {
        from: ethers.constants.AddressZero,
        to: depositor.address,
        value: amount,
      });
      await expectEvent(depositTx, vault.address, vault, "Deposited", {
        account: depositor.address,
        trancheId: 0,
        amount: amount,
        shares: amount,
      });

      /* Check token balances after deposit */
      expect(await tok1.balanceOf(depositor.address)).to.equal(ethers.constants.Zero);
      expect(await seniorLPToken.balanceOf(depositor.address)).to.equal(amount);
    });

    it("deposits into junior tranche", async function () {});

    it("fails on insufficient funds", async function () {});
  });

  describe("#depositMultiple", async function () {
    it("deposits into both tranches", async function () {});
  });

  describe("#sellNote", async function () {
    it("sells note", async function () {});
    it("fails on unsupported note token", async function () {});
    it("fails on unsupported note parameters", async function () {});
    it("fails on invalid purchase price", async function () {});
    it("fails on high purchase price", async function () {});
    it("fails on insufficient cash", async function () {});
    it("fails on low senior tranche return", async function () {});
  });

  describe("#sellNoteAndDeposit", async function () {
    it("sells note and deposits", async function () {});
  });

  describe("#sellNoteBatch", async function () {
    it("sells many notes", async function () {});
  });

  describe("#sellNoteAndDepositBatch", async function () {
    it("sells many notes and deposits proceeds", async function () {});
  });

  describe("#redeem", async function () {
    it("redeems", async function () {});
    it("fails on invalid shares", async function () {});
    it("fails on outstanding redemption", async function () {});
  });

  describe("#withdraw", async function () {
    it("withdraws successfully", async function () {});
    it("partial withdraws successfully", async function () {});
    it("fails on invalid amount", async function () {});
    it("fails on redemption not ready", async function () {});
  });

  describe("#withdrawCollateral", async function () {
    it("withdraws collateral after liquidation", async function () {});
    it("fails on invalid caller", async function () {});
    it("fails on invalid loan", async function () {});
    it("fails on unliquidated loan", async function () {});
    it("fails on already withdrawn collateral", async function () {});
  });

  describe("#onLoanRepaid", async function () {
    it("succeeds on repaid loan", async function () {});
    it("fails on unsupported note", async function () {});
    it("fails on unknown loan", async function () {});
    it("fails on unrepaid loan", async function () {});
    it("fails on processed loan", async function () {});
  });

  describe("#onLoanLiquidated", async function () {
    it("succeeds on liquidated loan", async function () {});
    it("fails on unsupported note", async function () {});
    it("fails on unknown loan", async function () {});
    it("fails on unliquidated loan", async function () {});
    it("fails on processed loan", async function () {});
  });

  describe("#onCollateralLiquidated", async function () {
    it("succeeds on liquidated collateral", async function () {});
    it("fails on invalid caller", async function () {});
    it("fails on unliquidated loan", async function () {});
    it("fails on liquidated loan and collateral", async function () {});
  });

  describe("#setSeniorTrancheRate", async function () {
    it("sets senior tranche rate successfully", async function () {});
    it("fails on invalid caller", async function () {});
  });

  describe("#setLoanPriceOracle", async function () {
    it("sets loan price oracle successfully", async function () {});
    it("fails on invalid caller", async function () {});
  });

  describe("#setCollateralLiquidator", async function () {
    it("sets collateral liquidator successfully", async function () {});
    it("fails on invalid caller", async function () {});
  });

  describe("#setNoteAdapter", async function () {
    it("sets note adapter successfully", async function () {});
    it("fails on invalid caller", async function () {});
  });
});
