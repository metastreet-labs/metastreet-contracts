import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import type { Contract } from "ethers";
import { LPToken } from "../typechain";

import { expectEvent } from "./helpers/EventUtilities";

describe("LPToken", function () {
  let accounts: SignerWithAddress[];
  let lpTokenBeacon: Contract;
  let lpToken: LPToken;
  let accountDepositor: SignerWithAddress;
  let snapshotId: string;

  before("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const lpTokenFactory = await ethers.getContractFactory("LPToken");

    /* Deploy LPToken Beacon */
    lpTokenBeacon = await upgrades.deployBeacon(lpTokenFactory);
    await lpTokenBeacon.deployed();

    /* Deploy Senior LP token */
    lpToken = (await upgrades.deployBeaconProxy(lpTokenBeacon.address, lpTokenFactory, [
      "Senior LP Token",
      "msLP-TEST-WETH",
    ])) as LPToken;
    await lpToken.deployed();

    /* Setup account */
    accountDepositor = accounts[4];
  });

  beforeEach("snapshot blockchain", async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);
  });

  afterEach("restore blockchain snapshot", async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  describe("constants", async function () {
    it("matches expected implementation", async function () {
      expect(await lpToken.IMPLEMENTATION_VERSION()).to.equal("1.0");
    });
  });

  describe("#initialize", async function () {
    it("fails on implementation contract", async function () {
      const lpTokenFactory = await ethers.getContractFactory("LPToken");
      const testLPToken = (await lpTokenFactory.deploy()) as LPToken;
      await testLPToken.deployed();

      await expect(testLPToken.initialize("Senior LP Token", "msLP-TEST-WETH")).to.be.revertedWith(
        "Initializable: contract is already initialized"
      );
    });
  });

  describe("#mint", async function () {
    it("succeeds in minting tokens", async function () {
      /* Mint tokens */
      await lpToken.mint(accountDepositor.address, ethers.utils.parseEther("5"));

      /* Check token balance */
      expect(await lpToken.balanceOf(accountDepositor.address)).to.equal(ethers.utils.parseEther("5"));
      expect(await lpToken.totalSupply()).to.equal(ethers.utils.parseEther("5"));
    });
    it("fails on invalid caller", async function () {
      await expect(
        lpToken.connect(accounts[1]).mint(accounts[0].address, ethers.utils.parseEther("100"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("#redeem", async function () {
    const mintAmount = ethers.utils.parseEther("5");
    const currencyAmount = ethers.utils.parseEther("10");
    const redemptionQueueTarget = ethers.utils.parseEther("25");

    beforeEach("setup mint", async function () {
      await lpToken.mint(accountDepositor.address, mintAmount);
    });

    it("succeeds on valid tokens", async function () {
      const redeemAmount = ethers.utils.parseEther("2");

      /* Redeem tokens */
      const redeemTx = await lpToken.redeem(
        accountDepositor.address,
        redeemAmount,
        currencyAmount,
        redemptionQueueTarget
      );
      await expectEvent(redeemTx, lpToken, "Transfer", {
        from: accountDepositor.address,
        to: ethers.constants.Zero,
        value: redeemAmount,
      });

      /* Check balance and redemption state */
      expect(await lpToken.balanceOf(accountDepositor.address)).to.equal(mintAmount.sub(redeemAmount));
      expect((await lpToken.redemptions(accountDepositor.address)).pending).to.equal(currencyAmount);
      expect((await lpToken.redemptions(accountDepositor.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await lpToken.redemptions(accountDepositor.address)).redemptionQueueTarget).to.equal(
        redemptionQueueTarget
      );
    });
    it("fails on insufficient tokens", async function () {
      const redeemAmount = ethers.utils.parseEther("7");

      /* Try to redeem too many tokens */
      await expect(
        lpToken.redeem(accountDepositor.address, redeemAmount, currencyAmount, redemptionQueueTarget)
      ).to.be.revertedWith("InsufficientBalance()");
    });
    it("fails on outstanding redemption", async function () {
      const redeemAmount = ethers.utils.parseEther("2");

      /* Redeem tokens */
      await lpToken.redeem(accountDepositor.address, redeemAmount, currencyAmount, redemptionQueueTarget);

      /* Try to redeem again */
      await expect(
        lpToken.redeem(accountDepositor.address, redeemAmount, currencyAmount, redemptionQueueTarget)
      ).to.be.revertedWith("RedemptionInProgress()");
    });
    it("fails on invalid caller", async function () {
      await expect(
        lpToken
          .connect(accounts[1])
          .redeem(accountDepositor.address, ethers.utils.parseEther("2"), currencyAmount, redemptionQueueTarget)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("#withdraw", async function () {
    const mintAmount = ethers.utils.parseEther("5");
    const redeemAmount = ethers.utils.parseEther("2");
    const currencyAmount = ethers.utils.parseEther("10");
    const redemptionQueueTarget = ethers.utils.parseEther("25");

    beforeEach("setup redemption", async function () {
      await lpToken.mint(accountDepositor.address, mintAmount);
      await lpToken.redeem(accountDepositor.address, redeemAmount, currencyAmount, redemptionQueueTarget);
    });

    it("succeeds on full withdrawal", async function () {
      /* Withdraw full amount */
      await lpToken.withdraw(accountDepositor.address, currencyAmount, redemptionQueueTarget.add(currencyAmount));

      /* Redmeption state should be cleared */
      expect((await lpToken.redemptions(accountDepositor.address)).pending).to.equal(ethers.constants.Zero);
      expect((await lpToken.redemptions(accountDepositor.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await lpToken.redemptions(accountDepositor.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );
    });
    it("succeeds on partial withdrawals", async function () {
      /* Withdraw 3 ETH */
      await lpToken.withdraw(
        accountDepositor.address,
        ethers.utils.parseEther("3"),
        redemptionQueueTarget.add(currencyAmount)
      );

      /* Check redemption state */
      expect((await lpToken.redemptions(accountDepositor.address)).pending).to.equal(currencyAmount);
      expect((await lpToken.redemptions(accountDepositor.address)).withdrawn).to.equal(ethers.utils.parseEther("3"));
      expect((await lpToken.redemptions(accountDepositor.address)).redemptionQueueTarget).to.equal(
        redemptionQueueTarget
      );

      /* Withdraw remaining 7 ETH */
      await lpToken.withdraw(
        accountDepositor.address,
        ethers.utils.parseEther("7"),
        redemptionQueueTarget.add(currencyAmount)
      );

      /* Redemption state should be cleared */
      expect((await lpToken.redemptions(accountDepositor.address)).pending).to.equal(ethers.constants.Zero);
      expect((await lpToken.redemptions(accountDepositor.address)).withdrawn).to.equal(ethers.constants.Zero);
      expect((await lpToken.redemptions(accountDepositor.address)).redemptionQueueTarget).to.equal(
        ethers.constants.Zero
      );
    });
    it("fails on excessive amount", async function () {
      /* Try to withdraw before redemption is ready */
      await expect(
        lpToken.withdraw(accountDepositor.address, ethers.utils.parseEther("1"), ethers.constants.Zero)
      ).to.be.revertedWith("InvalidAmount()");

      /* Try to withdraw too much from a partially ready redemption */
      await expect(
        lpToken.withdraw(
          accountDepositor.address,
          ethers.utils.parseEther("1.5"),
          redemptionQueueTarget.add(ethers.utils.parseEther("1"))
        )
      ).to.be.revertedWith("InvalidAmount()");

      /* Try to withdraw too much after redemption is ready */
      await expect(
        lpToken.withdraw(
          accountDepositor.address,
          currencyAmount.add(ethers.utils.parseEther("1")),
          redemptionQueueTarget.add(currencyAmount)
        )
      ).to.be.revertedWith("InvalidAmount()");
    });
    it("fails on invalid caller", async function () {
      await expect(
        lpToken
          .connect(accounts[1])
          .withdraw(accountDepositor.address, currencyAmount, redemptionQueueTarget.add(currencyAmount))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("#redemptionAvailable", async function () {
    const mintAmount = ethers.utils.parseEther("5");
    const redeemAmount = ethers.utils.parseEther("2");
    const currencyAmount = ethers.utils.parseEther("10");
    const redemptionQueueTarget = ethers.utils.parseEther("25");

    beforeEach("setup mint", async function () {
      await lpToken.mint(accountDepositor.address, mintAmount);
    });

    it("returns zero on no redemption pending", async function () {
      expect(await lpToken.redemptionAvailable(accountDepositor.address, redemptionQueueTarget)).to.equal(
        ethers.constants.Zero
      );
    });
    it("returns full amount on full redemption available", async function () {
      await lpToken.redeem(accountDepositor.address, redeemAmount, currencyAmount, redemptionQueueTarget);

      expect(
        await lpToken.redemptionAvailable(accountDepositor.address, redemptionQueueTarget.add(currencyAmount))
      ).to.equal(currencyAmount);
      expect(
        await lpToken.redemptionAvailable(accountDepositor.address, redemptionQueueTarget.add(currencyAmount.mul(2)))
      ).to.equal(currencyAmount);
    });
    it("returns partial amount on partial redemption available", async function () {
      await lpToken.redeem(accountDepositor.address, redeemAmount, currencyAmount, redemptionQueueTarget);

      expect(
        await lpToken.redemptionAvailable(
          accountDepositor.address,
          redemptionQueueTarget.add(ethers.utils.parseEther("1"))
        )
      ).to.equal(ethers.utils.parseEther("1"));
    });
    it("returns zero on no redemption available", async function () {
      /* Redeem tokens */
      await lpToken.redeem(accountDepositor.address, redeemAmount, currencyAmount, redemptionQueueTarget);

      expect(
        await lpToken.redemptionAvailable(
          accountDepositor.address,
          redemptionQueueTarget.sub(ethers.utils.parseEther("1"))
        )
      ).to.equal(ethers.constants.Zero);
      expect(await lpToken.redemptionAvailable(accountDepositor.address, redemptionQueueTarget)).to.equal(
        ethers.constants.Zero
      );
    });
  });
});
