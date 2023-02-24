/* eslint-disable camelcase */
import * as dotenv from "dotenv";

import { expect } from "chai";
import { ethers, network } from "hardhat";

import { BigNumber } from "@ethersproject/bignumber";

import { IAddressProvider__factory, IERC721__factory, INoteAdapter, IXY3__factory } from "../../typechain";

dotenv.config();

describe("XY3NoteAdapter", function () {
  const WETH_TOKEN = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const XY3_ADDRESS = "0xFa4D5258804D7723eb6A934c11b1bd423bC31623";

  /* moon bird */
  const XY3_LOAN_ID = 10476;
  const XY3_NOTE_TOKEN_ID = BigNumber.from("1955385066090783700");

  let noteAdapter: INoteAdapter;

  /* notes */
  let lenderNote: string;
  let borrowerNote: string;

  /* xy3 loan details */
  let borrowAmount: BigNumber;
  let repayAmount: BigNumber;
  let nftTokenId: BigNumber;
  let loanDuration: number;
  let loanStart: BigNumber;
  let nftAsset: string;
  let _borrower: string; /* borrower */

  let snapshotId: string;

  before("fork mainnet and deploy fixture", async function () {
    /* skip test if no MAINNET_URL env variable */
    if (!process.env.MAINNET_URL) {
      this.skip();
    }

    /* block from Feb 07 2023 */
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber: 16575682,
          },
        },
      ],
    });

    const ixy3 = IXY3__factory.connect(XY3_ADDRESS, ethers.provider);
    const addressProvider = await ixy3.getAddressProvider();

    lenderNote = await IAddressProvider__factory.connect(addressProvider, ethers.provider).getLenderNote();
    borrowerNote = await IAddressProvider__factory.connect(addressProvider, ethers.provider).getBorrowerNote();

    /* deploy test noteAdapter */
    const x2y2NoteAdapter = await ethers.getContractFactory("XY3NoteAdapter");

    noteAdapter = (await x2y2NoteAdapter.deploy(XY3_ADDRESS)) as INoteAdapter;
    await noteAdapter.deployed();

    /* get loan details from contract and assign to note adapter scoped variables */
    [borrowAmount, repayAmount, nftTokenId, , loanDuration, , loanStart, nftAsset, ,] = await ixy3.loanDetails(
      XY3_LOAN_ID
    );

    /* get borrower details from contract */
    _borrower = await IERC721__factory.connect(borrowerNote, ethers.provider).ownerOf(XY3_NOTE_TOKEN_ID);
  });

  after("reset network", async () => {
    await network.provider.request({ method: "hardhat_reset" });
  });

  beforeEach("snapshot blockchain", async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);
  });

  afterEach("restore blockchain snapshot", async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  describe("note and address", async () => {
    it("returns correct name", async () => {
      expect(await noteAdapter.name()).to.equal("XY3 Note Adapter");
    });

    it("returns correct note token address", async () => {
      expect(await noteAdapter.noteToken()).to.equal(lenderNote);
    });
  });

  describe("#isSupported", async () => {
    it("returns true for supported collateral", async () => {
      expect(await noteAdapter.isSupported(XY3_NOTE_TOKEN_ID, WETH_TOKEN)).to.equal(true);
    });

    it("returns false on non-existent token ID", async () => {
      expect(await noteAdapter.isSupported(BigNumber.from("1955385066090783799"), WETH_TOKEN)).to.equal(false);
    });

    it("returns false for inactive (repaid) loan", async () => {
      expect(await noteAdapter.isSupported(BigNumber.from("4468936665517476250"), WETH_TOKEN)).to.equal(false);
    });
  });

  describe("#getLoanInfo", async () => {
    it("returns correct loan info", async () => {
      /* use note adapter to get loan details */
      const [
        loanId,
        borrower,
        principal,
        repayment,
        maturity,
        duration,
        currencyToken,
        collateralToken,
        collateralTokenId,
      ] = await noteAdapter.getLoanInfo(XY3_NOTE_TOKEN_ID);

      /* test against values returned by contract */
      expect(loanId).to.equal(XY3_LOAN_ID);
      expect(borrower).to.equal(_borrower);
      expect(principal).to.equal(borrowAmount);
      expect(repayment).to.equal(repayAmount);
      expect(maturity).to.equal(loanStart.toNumber() + loanDuration);
      expect(duration).to.equal(loanDuration);
      expect(currencyToken).to.equal(WETH_TOKEN);
      expect(collateralToken).to.equal(nftAsset);
      expect(collateralTokenId).to.equal(nftTokenId);
    });
  });

  describe("#getLoanAssets", async () => {
    it("returns correct loan assets", async () => {
      /* get loan details from contract */
      const [, , nfttokenId, , , , , nftAsset, , ,] = await IXY3__factory.connect(
        XY3_ADDRESS,
        ethers.provider
      ).loanDetails(XY3_LOAN_ID);

      /* use note adapter to get loan assets */
      const [token, tokenId] = (await noteAdapter.getLoanAssets(XY3_NOTE_TOKEN_ID))[0];
      expect(token).to.equal(nftAsset);
      expect(tokenId).to.equal(nfttokenId);
    });
  });

  describe("#getLiquidateCalldata", async () => {
    it("returns correct address and calldata", async () => {
      const ABI = ["function liquidate(uint32)"];
      const iface = new ethers.utils.Interface(ABI);

      const [address, calldata] = await noteAdapter.getLiquidateCalldata(XY3_LOAN_ID);

      expect(address).to.equal(XY3_ADDRESS);
      expect(calldata).to.equal(iface.encodeFunctionData("liquidate", [XY3_LOAN_ID]));
    });
  });

  describe("#isRepaid", async () => {
    it("returns true for repaid loan", async () => {
      expect(await noteAdapter.isRepaid(10322)).to.equal(true);
    });

    it("returns false for active loan", async () => {
      expect(await noteAdapter.isRepaid(XY3_LOAN_ID)).to.equal(false);
    });
  });

  describe("#isLiquidated", async () => {
    it("returns true for liquidated loan", async () => {
      expect(await noteAdapter.isLiquidated(10322)).to.equal(true);
    });

    it("returns false for active loan", async () => {
      expect(await noteAdapter.isLiquidated(XY3_LOAN_ID)).to.equal(false);
    });
  });

  describe("#isExpired", async () => {
    it("returns true for expired loan", async () => {
      await ethers.provider.send("evm_mine", [loanStart.toNumber() + loanDuration + 1]);
      expect(await noteAdapter.isExpired(XY3_LOAN_ID)).to.equal(true);
    });

    it("returns false for current loan", async () => {
      expect(await noteAdapter.isExpired(XY3_LOAN_ID)).to.equal(false);
    });
  });
});
