/* eslint-disable camelcase */
import * as dotenv from "dotenv";

import { expect } from "chai";
import { ethers, network } from "hardhat";

import { BigNumber } from "@ethersproject/bignumber";

import { IERC721__factory, ILoanCore__factory, INoteAdapter } from "../../typechain";

dotenv.config();

describe("ArcadeV2NoteAdapter", function () {
  const WETH_TOKEN = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const LOAN_CORE = "0x81b2F8Fc75Bab64A6b144aa6d2fAa127B4Fa7fD9";
  const REPAYMENT_CONTROLLER = "0xb39dAB85FA05C381767FF992cCDE4c94619993d4";
  const VAULT_DEPOSIT_ROUTER = "0xFDda20a20cb4249e73e3356f468DdfdfB61483F6";
  const BASIS_POINTS_DENOMINATOR = 10_000;

  const BORROWER_NOTE = "0x337104A4f06260Ff327d6734C555A0f5d8F863aa";
  const LENDER_NOTE = "0x349A026A43FFA8e2Ab4c4e59FCAa93F87Bd8DdeE";

  /* loanId and note tokenId are same on Arcade */
  const ARCADE_LOAN_ID = 954;

  /* arcade distinguishes between repaid and liquidated loans */
  const REPAID_ARCADE_LOAN_ID = 511;
  const LIQUIDATED_ARCADE_LOAN_ID = 307;

  /* arcade constant */
  const INTEREST_RATE_DENOMINATOR = 1e18;

  /* loan terms */
  type LoanTerms = {
    durationSecs: number;
    deadline: number;
    numInstallments: number;
    interestRate: BigNumber;
    principal: BigNumber;
    collateralAddress: string;
    collateralId: BigNumber;
    payableCurrency: string;
  };

  let noteAdapter: INoteAdapter;

  /* loan details */
  let startDate: BigNumber;
  let terms: LoanTerms;

  /* borrower */
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

    const arcadeNoteAdapter = await ethers.getContractFactory("ArcadeV2NoteAdapter");

    noteAdapter = (await arcadeNoteAdapter.deploy(
      LOAN_CORE,
      REPAYMENT_CONTROLLER,
      VAULT_DEPOSIT_ROUTER
    )) as INoteAdapter;
    await noteAdapter.deployed();

    /* get loan details from contract and assign to note adapter scoped variables */
    [, , startDate, terms, , , ,] = await ILoanCore__factory.connect(LOAN_CORE, ethers.provider).getLoan(
      ARCADE_LOAN_ID
    );

    /* get borrower */
    _borrower = await IERC721__factory.connect(BORROWER_NOTE, ethers.provider).ownerOf(ARCADE_LOAN_ID);
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
      expect(await noteAdapter.name()).to.equal("Arcade v2 Note Adapter");
    });

    it("returns correct note token address", async () => {
      expect(await noteAdapter.noteToken()).to.equal(LENDER_NOTE);
    });
  });

  describe("#isSupported", async () => {
    it("returns true for supported collateral", async () => {
      expect(await noteAdapter.isSupported(ARCADE_LOAN_ID, WETH_TOKEN)).to.equal(true);
    });

    it("returns false on non-existent token ID", async () => {
      expect(await noteAdapter.isSupported(5858585, WETH_TOKEN)).to.equal(false);
    });

    it("returns false on USDC loan", async () => {
      /* transaction 0x8992ea0cfbb6412f99d491565d5c3eaf5ffa3851e74f2a04e75212ddbf955409 */
      expect(await noteAdapter.isSupported(804, WETH_TOKEN)).to.equal(false);
    });

    it("returns false for inactive (repaid) loan", async () => {
      /* repaid in txn 0x8a91afaeceacf88a4180dbb9dc3244406c4eb0e9708fa797344c257d30594e64 */
      expect(await noteAdapter.isSupported(REPAID_ARCADE_LOAN_ID, WETH_TOKEN)).to.equal(false);
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
      ] = await noteAdapter.getLoanInfo(ARCADE_LOAN_ID);

      /* calculate repayment */
      const interest = terms.principal
        .mul(terms.interestRate)
        .div(BigNumber.from(INTEREST_RATE_DENOMINATOR.toString()))
        .div(BASIS_POINTS_DENOMINATOR);

      const repaymentAmount = principal.add(interest);

      expect(loanId).to.equal(ARCADE_LOAN_ID);
      expect(borrower).to.equal(_borrower);
      expect(principal).to.equal(terms.principal);
      expect(repayment).to.equal(repaymentAmount);
      expect(maturity).to.equal(startDate.toNumber() + terms.durationSecs);
      expect(duration).to.equal(terms.durationSecs);
      expect(currencyToken).to.equal(WETH_TOKEN);
      expect(collateralToken).to.equal(terms.collateralAddress);
      expect(collateralTokenId).to.equal(terms.collateralId);
    });
  });

  describe("#getLoanAssets", async () => {
    it("returns correct loan assets", async () => {
      const [token, tokenId] = (await noteAdapter.getLoanAssets(ARCADE_LOAN_ID))[0];
      expect(token).to.equal(terms.collateralAddress);
      expect(tokenId).to.equal(terms.collateralId);
    });
  });

  describe("#getLiquidateCalldata", async () => {
    it("returns correct address and calldata", async () => {
      const ABI = ["function claim(uint256)"];
      const iface = new ethers.utils.Interface(ABI);

      const [address, calldata] = await noteAdapter.getLiquidateCalldata(ARCADE_LOAN_ID);

      expect(address).to.equal(REPAYMENT_CONTROLLER);
      expect(calldata).to.equal(iface.encodeFunctionData("claim", [ARCADE_LOAN_ID]));
    });
  });

  describe("#isRepaid", async () => {
    it("returns true for repaid loan", async () => {
      /* transaction 0x6835b95564962de2988d87bfcc700f673d9810c76fadc0adaf2d34e11d98bb0e */
      expect(await noteAdapter.isRepaid(REPAID_ARCADE_LOAN_ID)).to.equal(true);
    });

    it("returns false for active loan", async () => {
      expect(await noteAdapter.isRepaid(ARCADE_LOAN_ID)).to.equal(false);
    });

    it("returns false for liquidated loan", async () => {
      expect(await noteAdapter.isRepaid(LIQUIDATED_ARCADE_LOAN_ID)).to.equal(false);
    });
  });

  describe("#isLiquidated", async () => {
    it("returns true for liquidated loan", async () => {
      /* transaction 0x2136febaba3e690e8e6385a846c3c5f17687e811eaacbda0bb54d870e9f23c5c */
      expect(await noteAdapter.isLiquidated(LIQUIDATED_ARCADE_LOAN_ID)).to.equal(true);
    });

    it("returns false for active loan", async () => {
      expect(await noteAdapter.isLiquidated(ARCADE_LOAN_ID)).to.equal(false);
    });

    it("returns false for repaid loan", async () => {
      expect(await noteAdapter.isLiquidated(REPAID_ARCADE_LOAN_ID)).to.equal(false);
    });
  });

  describe("#isExpired", async () => {
    it("returns true for expired loan", async () => {
      await ethers.provider.send("evm_mine", [startDate.toNumber() + terms.durationSecs + 1]);
      expect(await noteAdapter.isExpired(ARCADE_LOAN_ID)).to.equal(true);
    });

    it("returns false for current loan", async () => {
      expect(await noteAdapter.isExpired(ARCADE_LOAN_ID)).to.equal(false);
    });
  });
});
