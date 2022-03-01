import { expect } from "chai";
import { ethers } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { LPToken } from "../typechain";

describe("LPToken", function () {
  let accounts: SignerWithAddress[];
  let seniorLPToken: LPToken;
  let juniorLPToken: LPToken;

  beforeEach("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const lpTokenFactory = await ethers.getContractFactory("LPToken");

    /* Deploy Senior LP token */
    seniorLPToken = (await lpTokenFactory.deploy()) as LPToken;
    await seniorLPToken.deployed();
    await seniorLPToken.initialize("Senior LP Token", "msLP-TEST-WETH");

    /* Deploy Junior LP token */
    juniorLPToken = (await lpTokenFactory.deploy()) as LPToken;
    await juniorLPToken.deployed();
    await juniorLPToken.initialize("Junior LP Token", "mjLP-TEST-WETH");
  });

  describe("constants", async function () {
    it("matches expected implementation", async function () {
      expect(await seniorLPToken.IMPLEMENTATION_VERSION()).to.equal("1.0");
      expect(await juniorLPToken.IMPLEMENTATION_VERSION()).to.equal("1.0");
    });
  });

  describe("#mint", async function () {
    it("fails on invalid caller", async function () {
      await expect(
        seniorLPToken.connect(accounts[1]).mint(accounts[0].address, ethers.utils.parseEther("100"))
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        juniorLPToken.connect(accounts[1]).mint(accounts[0].address, ethers.utils.parseEther("100"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("#redeem", async function () {
    it("fails on invalid caller", async function () {
      await expect(
        seniorLPToken
          .connect(accounts[1])
          .redeem(
            accounts[0].address,
            ethers.utils.parseEther("100"),
            ethers.utils.parseEther("1000"),
            ethers.constants.Zero
          )
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        juniorLPToken
          .connect(accounts[1])
          .redeem(
            accounts[0].address,
            ethers.utils.parseEther("100"),
            ethers.utils.parseEther("1000"),
            ethers.constants.Zero
          )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("#withdraw", async function () {
    it("fails on invalid caller", async function () {
      await expect(
        seniorLPToken
          .connect(accounts[1])
          .withdraw(accounts[0].address, ethers.utils.parseEther("100"), ethers.utils.parseEther("1000"))
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        juniorLPToken
          .connect(accounts[1])
          .withdraw(accounts[0].address, ethers.utils.parseEther("100"), ethers.utils.parseEther("1000"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
