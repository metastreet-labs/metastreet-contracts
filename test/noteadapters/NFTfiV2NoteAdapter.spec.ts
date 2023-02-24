/* eslint-disable camelcase */
import * as dotenv from "dotenv";

import { expect } from "chai";
import { ethers, network } from "hardhat";

import { BigNumber } from "@ethersproject/bignumber";

import { IDirectLoanCoordinator__factory, IDirectLoan__factory, INoteAdapter } from "../../typechain";

dotenv.config();

describe("NFTfiV2NoteAdapter", function () {
  const WETH_TOKEN = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const DIRECT_LOAN_COORDINATOR = "0x0C90C8B4aa8549656851964d5fB787F0e4F54082";
  const DIRECT_LOAN_FIXED_REDEPLOY = "0x8252Df1d8b29057d1Afe3062bf5a64D503152BC8";
  const NFTFI_NOTE_TOKEN_ADDRESS = "0x5660E206496808F7b5cDB8C56A696a96AE5E9b23";
  const BASIS_POINTS_DENOMINATOR = 10_000;

  /* world of women */
  const NFTFI_LOAN_ID = 24290;
  const NFTFI_NOTE_TOKEN_ID = BigNumber.from("3470274519206011530");

  let noteAdapter: INoteAdapter;

  /* nftfiv2 loan details */
  let loanPrincipalAmount: BigNumber;
  let maximumRepaymentAmount: BigNumber;
  let nftCollateralId: BigNumber;
  let loanDuration: number;
  let loanAdminFeeInBasisPoints: number;
  let loanStartTime: BigNumber;
  let nftCollateralContract: string;
  let _borrower: string;

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

    const nFTfiV2NoteAdapter = await ethers.getContractFactory("NFTfiV2NoteAdapter");

    noteAdapter = (await nFTfiV2NoteAdapter.deploy(DIRECT_LOAN_COORDINATOR)) as INoteAdapter;
    await noteAdapter.deployed();

    const loanContract = (
      await IDirectLoanCoordinator__factory.connect(DIRECT_LOAN_COORDINATOR, ethers.provider).getLoanData(NFTFI_LOAN_ID)
    )[0] as string;

    /* get loan details from contract and assign to note adapter scoped variables */
    [
      loanPrincipalAmount,
      maximumRepaymentAmount,
      nftCollateralId,
      ,
      loanDuration,
      ,
      loanAdminFeeInBasisPoints,
      ,
      loanStartTime,
      nftCollateralContract,
      _borrower,
    ] = await IDirectLoan__factory.connect(loanContract, ethers.provider).loanIdToLoan(NFTFI_LOAN_ID);
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
      expect(await noteAdapter.name()).to.equal("NFTfi v2 Note Adapter");
    });

    it("returns correct note token address", async () => {
      expect(await noteAdapter.noteToken()).to.equal(NFTFI_NOTE_TOKEN_ADDRESS);
    });
  });

  describe("#isSupported", async () => {
    it("returns true for supported collateral - wrapped punk", async () => {
      expect(await noteAdapter.isSupported(NFTFI_NOTE_TOKEN_ID, WETH_TOKEN)).to.equal(true);
    });

    it("returns false on non-existent token ID", async () => {
      expect(await noteAdapter.isSupported(BigNumber.from("3470274519206011529"), WETH_TOKEN)).to.equal(false);
    });

    it("returns false on USDC loan", async () => {
      expect(await noteAdapter.isSupported(BigNumber.from("16792144585544622812"), WETH_TOKEN)).to.equal(false);
    });

    it("returns false for inactive (repaid) loan", async () => {
      expect(await noteAdapter.isSupported(BigNumber.from("13308423289920683228"), WETH_TOKEN)).to.equal(false);
    });
  });

  describe("#getLoanInfo", async () => {
    it("returns correct loan info", async () => {
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
      ] = await noteAdapter.getLoanInfo(NFTFI_NOTE_TOKEN_ID);

      /* calculate repayment amount */
      const interest = maximumRepaymentAmount.sub(loanPrincipalAmount);
      const adminFee = interest.mul(loanAdminFeeInBasisPoints).div(BASIS_POINTS_DENOMINATOR);
      const repaymentAmount = maximumRepaymentAmount.sub(adminFee);

      expect(loanId).to.equal(NFTFI_LOAN_ID);
      expect(borrower).to.equal(_borrower);
      expect(principal).to.equal(loanPrincipalAmount);
      expect(repayment).to.equal(repaymentAmount);
      expect(maturity).to.equal(loanStartTime.toNumber() + loanDuration);
      expect(duration).to.equal(loanDuration);
      expect(currencyToken).to.equal(WETH_TOKEN);
      expect(collateralToken).to.equal(nftCollateralContract);
      expect(collateralTokenId).to.equal(nftCollateralId);
    });
  });

  describe("#getLoanAssets", async () => {
    it("returns correct loan assets", async () => {
      const [token, tokenId] = (await noteAdapter.getLoanAssets(NFTFI_NOTE_TOKEN_ID))[0];
      expect(token).to.equal(nftCollateralContract);
      expect(tokenId).to.equal(nftCollateralId);
    });
  });

  describe("#getLiquidateCalldata", async () => {
    it("returns correct address and calldata", async () => {
      const ABI = ["function liquidateOverdueLoan(uint32)"];
      const iface = new ethers.utils.Interface(ABI);

      const [address, calldata] = await noteAdapter.getLiquidateCalldata(NFTFI_LOAN_ID);

      expect(address).to.equal(DIRECT_LOAN_FIXED_REDEPLOY);
      expect(calldata).to.equal(iface.encodeFunctionData("liquidateOverdueLoan", [NFTFI_LOAN_ID]));
    });
  });

  describe("#isRepaid", async () => {
    it("returns true for repaid loan", async () => {
      expect(await noteAdapter.isRepaid(23983)).to.equal(true);
    });

    it("returns false for active loan", async () => {
      expect(await noteAdapter.isRepaid(NFTFI_LOAN_ID)).to.equal(false);
    });
  });

  describe("#isLiquidated", async () => {
    it("returns true for liquidated loan", async () => {
      expect(await noteAdapter.isLiquidated(19785)).to.equal(true);
    });

    it("returns false for active loan", async () => {
      expect(await noteAdapter.isLiquidated(NFTFI_LOAN_ID)).to.equal(false);
    });
  });

  describe("#isExpired", async () => {
    it("returns true for expired loan", async () => {
      await ethers.provider.send("evm_mine", [loanStartTime.toNumber() + loanDuration + 1]);
      expect(await noteAdapter.isExpired(NFTFI_LOAN_ID)).to.equal(true);
    });

    it("returns false for current loan", async () => {
      expect(await noteAdapter.isExpired(NFTFI_LOAN_ID)).to.equal(false);
    });
  });
});
