import { expect } from "chai";
import { ethers } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { TestERC20, Vault, LPToken } from "../typechain";

describe("LPToken", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let vault: Vault;
  let seniorLPToken: LPToken;
  let juniorLPToken: LPToken;

  beforeEach("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const vaultFactory = await ethers.getContractFactory("Vault");

    tok1 = (await testERC20Factory.deploy("WETH", "WETH", ethers.utils.parseEther("1000"))) as TestERC20;
    await tok1.deployed();

    vault = (await vaultFactory.deploy("Test Vault", "TEST", tok1.address, ethers.constants.AddressZero)) as Vault;
    await vault.deployed();

    seniorLPToken = (await ethers.getContractAt("LPToken", await vault.lpToken(0))) as LPToken;
    juniorLPToken = (await ethers.getContractAt("LPToken", await vault.lpToken(1))) as LPToken;
  });

  describe("#mint", async function () {
    it("fails on invalid caller", async function () {
      await expect(seniorLPToken.mint(accounts[0].address, ethers.utils.parseEther("100"))).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(juniorLPToken.mint(accounts[0].address, ethers.utils.parseEther("100"))).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });

  describe("#redeem", async function () {
    it("fails on invalid caller", async function () {
      await expect(
        seniorLPToken.redeem(
          accounts[0].address,
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("1000"),
          ethers.constants.Zero
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        juniorLPToken.redeem(
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
        seniorLPToken.withdraw(accounts[0].address, ethers.utils.parseEther("100"), ethers.utils.parseEther("1000"))
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        juniorLPToken.withdraw(accounts[0].address, ethers.utils.parseEther("100"), ethers.utils.parseEther("1000"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
