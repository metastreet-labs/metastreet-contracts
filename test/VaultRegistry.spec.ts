import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { VaultRegistry } from "../typechain";

import { expectEvent } from "./helpers/EventUtilities";
import { randomAddress } from "./helpers/VaultHelpers";

describe("VaultRegistry", function () {
  let accounts: SignerWithAddress[];
  let vaultRegistry: VaultRegistry;
  let snapshotId: string;

  before("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const vaultRegistryFactory = await ethers.getContractFactory("VaultRegistry");

    /* Deploy Vault Registry */
    vaultRegistry = (await vaultRegistryFactory.deploy()) as VaultRegistry;
    await vaultRegistry.deployed();
  });

  beforeEach("snapshot blockchain", async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);
  });

  afterEach("restore blockchain snapshot", async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  describe("constants", async function () {
    it("matches implementation version", async function () {
      expect(await vaultRegistry.IMPLEMENTATION_VERSION()).to.equal("1.0");
    });
  });

  describe("#registerVault", async function () {
    it("registers successfully", async function () {
      const addr = randomAddress();

      /* Register the vault */
      const registerTx = await vaultRegistry.registerVault(addr);
      await expectEvent(registerTx, vaultRegistry, "VaultRegistered", {
        vault: addr,
      });
    });
    it("no operation on existing vault", async function () {
      const addr = randomAddress();

      /* Register the vault */
      await vaultRegistry.registerVault(addr);

      /* Register a second time */
      const registerTx = await vaultRegistry.registerVault(addr);

      /* Check no logs were emitted */
      expect((await registerTx.wait()).logs.length).to.equal(0);
    });
    it("fails for invalid caller", async function () {
      await expect(vaultRegistry.connect(accounts[1]).registerVault(randomAddress())).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });

  describe("#unregisterVault", async function () {
    it("unregisters successfully", async function () {
      const addr = randomAddress();

      /* Register the vault */
      await vaultRegistry.registerVault(addr);

      /* Unregister the vault */
      const unregisterTx = await vaultRegistry.unregisterVault(addr);
      await expectEvent(unregisterTx, vaultRegistry, "VaultUnregistered", {
        vault: addr,
      });
    });
    it("no operation on non-existing vault", async function () {
      const addr = randomAddress();

      /* Register the vault */
      await vaultRegistry.registerVault(addr);

      /* Unregister the vault */
      await vaultRegistry.unregisterVault(addr);

      /* Unregister a second time */
      const unregisterTx = await vaultRegistry.unregisterVault(addr);

      /* Check no logs were emitted */
      expect((await unregisterTx.wait()).logs.length).to.equal(0);
    });
    it("fails for invalid caller", async function () {
      await expect(vaultRegistry.connect(accounts[1]).unregisterVault(randomAddress())).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });

  describe("getters", async function () {
    const addrs = [randomAddress(), randomAddress(), randomAddress()];

    beforeEach("register multiple vaults", async () => {
      /* Register vaults */
      await vaultRegistry.registerVault(addrs[0]);
      await vaultRegistry.registerVault(addrs[1]);
      await vaultRegistry.registerVault(addrs[2]);
    });

    it("getters are correct", async function () {
      /* Check vault count */
      expect(await vaultRegistry.getVaultCount()).to.equal(3);

      /* Check is registered */
      expect(await vaultRegistry.isVaultRegistered(addrs[0])).to.equal(true);
      expect(await vaultRegistry.isVaultRegistered(addrs[1])).to.equal(true);
      expect(await vaultRegistry.isVaultRegistered(addrs[2])).to.equal(true);

      /* Check readback through getVaultList() */
      let addrsRead = [...(await vaultRegistry.getVaultList())];
      expect(addrsRead.sort()).to.deep.equal(addrs.sort());

      /* Check readback through getVaultAt() */
      addrsRead = [
        await vaultRegistry.getVaultAt(0),
        await vaultRegistry.getVaultAt(1),
        await vaultRegistry.getVaultAt(2),
      ];
      expect(addrsRead.sort()).to.deep.equal(addrs.sort());

      /* Unregister a vault */
      await vaultRegistry.unregisterVault(addrs[1]);

      /* Check vault count */
      expect(await vaultRegistry.getVaultCount()).to.equal(2);

      /* Check is registered */
      expect(await vaultRegistry.isVaultRegistered(addrs[0])).to.equal(true);
      expect(await vaultRegistry.isVaultRegistered(addrs[1])).to.equal(false);
      expect(await vaultRegistry.isVaultRegistered(addrs[2])).to.equal(true);

      /* Check readback through getVaultAt() */
      addrsRead = [...(await vaultRegistry.getVaultList())];
      expect(addrsRead.sort()).to.deep.equal([addrs[0], addrs[2]].sort());

      /* Check readback through getVaultList() */
      addrsRead = [await vaultRegistry.getVaultAt(0), await vaultRegistry.getVaultAt(1)];
      expect(addrsRead.sort()).to.deep.equal([addrs[0], addrs[2]].sort());

      /* Check out of bounds access reverts */
      await expect(vaultRegistry.getVaultAt(3)).to.be.reverted;
    });
  });
});
