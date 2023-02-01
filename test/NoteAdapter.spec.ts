/* eslint-disable camelcase */
import * as dotenv from "dotenv";

import { expect } from "chai";
import { ethers, network } from "hardhat";

import { BigNumber } from "@ethersproject/bignumber";

import {
  IDirectLoanCoordinator__factory,
  IDirectLoan__factory,
  IERC721__factory,
  ILoanCore__factory,
  INoteAdapter,
  IXY3__factory,
} from "../typechain";

dotenv.config();

const WETH_TOKEN = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const BASIS_POINTS_DENOMINATOR = 10_000;

describe("Note Adapters", function () {
  /* skip test if no MAINNET_URL env variable */
  if (!process.env.MAINNET_URL) {
    console.log("\nSkipping note adapter mainnet fork test - no MAINNET_URL env variable found");
    return;
  }

  let snapshotId: string;
  let noteAdapter: INoteAdapter;

  before("fork mainnet", async () => {
    /* block from Jan 31 2023 */
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber: 16528861,
          },
        },
      ],
    });
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

  describe("XY3NoteAdapter", async () => {
    const XY3_ADDRESS = "0xC28F7Ee92Cd6619e8eEC6A70923079fBAFb86196";
    const XY3_NOTE_TOKEN_ADDRESS = "0x0E258c84Df0f8728ae4A6426EA5FD163Eb6b9D1B";

    /* cool cat */
    const XY3_LOAN_ID = 4715;
    const XY3_NOTE_TOKEN_ID = BigNumber.from("4307497666888050624");

    /* xy3 loan details */
    let borrowAmount: BigNumber;
    let repayAmount: BigNumber;
    let nftTokenId: BigNumber;
    let loanDuration: number;
    let loanStart: BigNumber;
    let nftAsset: string;
    let _borrower: string; /* borrower */

    before("deploy fixture", async () => {
      /* deploy test noteAdapter */
      const x2y2NoteAdapter = await ethers.getContractFactory("XY3NoteAdapter");

      noteAdapter = (await x2y2NoteAdapter.deploy(XY3_ADDRESS, XY3_NOTE_TOKEN_ADDRESS)) as INoteAdapter;
      await noteAdapter.deployed();

      /* get loan details from contract and assign to note adapter scoped variables */
      [borrowAmount, repayAmount, nftTokenId, , loanDuration, , loanStart, nftAsset, _borrower, ,] =
        await IXY3__factory.connect(XY3_ADDRESS, ethers.provider).loanDetails(XY3_LOAN_ID);
    });

    describe("note and address", async () => {
      it("returns correct name", async () => {
        expect(await noteAdapter.name()).to.equal("XY3 Note Adapter");
      });

      it("returns correct note token address", async () => {
        expect(await noteAdapter.noteToken()).to.equal(XY3_NOTE_TOKEN_ADDRESS);
      });
    });

    describe("#isSupported", async () => {
      it("returns true for supported collateral", async () => {
        expect(await noteAdapter.isSupported(XY3_NOTE_TOKEN_ID, WETH_TOKEN)).to.equal(true);
      });

      it("returns false on non-existent token ID", async () => {
        expect(await noteAdapter.isSupported(BigNumber.from("5698387920423443805"), WETH_TOKEN)).to.equal(false);
      });

      it("returns false for inactive (repaid) loan", async () => {
        /* repaid in txn 0x8a91afaeceacf88a4180dbb9dc3244406c4eb0e9708fa797344c257d30594e64 */
        expect(await noteAdapter.isSupported(BigNumber.from("6104004959707999123"), WETH_TOKEN)).to.equal(false);
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
        /* repaid in txn 0x8a91afaeceacf88a4180dbb9dc3244406c4eb0e9708fa797344c257d30594e64 */
        expect(await noteAdapter.isRepaid(3691)).to.equal(true);
      });

      it("returns false for active loan", async () => {
        expect(await noteAdapter.isRepaid(XY3_LOAN_ID)).to.equal(false);
      });
    });

    describe("#isLiquidated", async () => {
      it("returns true for liquidated loan", async () => {
        /* repaid in txn 0x2648f623096f20fc6430fc8c2a76c4970f937ec9826a64da445e02b5dd52294f */
        expect(await noteAdapter.isLiquidated(3663)).to.equal(true);
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

  describe("NFTfiV2NoteAdapter", async () => {
    const DIRECT_LOAN_COORDINATOR = "0x0C90C8B4aa8549656851964d5fB787F0e4F54082";
    const DIRECT_LOAN_FIXED_REDEPLOY = "0x8252Df1d8b29057d1Afe3062bf5a64D503152BC8";
    const NFTFI_NOTE_TOKEN_ADDRESS = "0x5660E206496808F7b5cDB8C56A696a96AE5E9b23";

    /* wrapped punk */
    const NFTFI_LOAN_ID = 23360;
    const NFTFI_NOTE_TOKEN_ID = BigNumber.from("2896420040608988986");

    /* loan data */
    let loanContract: string;

    /* nftfiv2 loan details */
    let loanPrincipalAmount: BigNumber;
    let maximumRepaymentAmount: BigNumber;
    let nftCollateralId: BigNumber;
    let loanDuration: number;
    let loanAdminFeeInBasisPoints: number;
    let loanStartTime: BigNumber;
    let nftCollateralContract: string;
    let _borrower: string;

    before("deploy fixture", async () => {
      const nFTfiV2NoteAdapter = await ethers.getContractFactory("NFTfiV2NoteAdapter");

      noteAdapter = (await nFTfiV2NoteAdapter.deploy(DIRECT_LOAN_COORDINATOR)) as INoteAdapter;
      await noteAdapter.deployed();

      loanContract = (
        await IDirectLoanCoordinator__factory.connect(DIRECT_LOAN_COORDINATOR, ethers.provider).getLoanData(
          NFTFI_LOAN_ID
        )
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
        expect(await noteAdapter.isSupported(BigNumber.from("5698387920423443805"), WETH_TOKEN)).to.equal(false);
      });

      it("returns false on USDC loan", async () => {
        /* transaction 0x530d84d412bc59b095839dd47b0cf91287daf85b4612b3cfb998010eff60ffab */
        expect(await noteAdapter.isSupported(BigNumber.from("18221251482556693931"), WETH_TOKEN)).to.equal(false);
      });

      it("returns false for inactive (repaid) loan", async () => {
        /* repaid in txn 0x8a91afaeceacf88a4180dbb9dc3244406c4eb0e9708fa797344c257d30594e64 */
        expect(await noteAdapter.isSupported(BigNumber.from("5077543603509491697"), WETH_TOKEN)).to.equal(false);
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
        /* transaction 0x63c82bacd6f9cead887cffdfdc9ec325433d4bb57c94cc09815423885dc52e46 */
        expect(await noteAdapter.isRepaid(19900)).to.equal(true);
      });

      it("returns false for active loan", async () => {
        expect(await noteAdapter.isRepaid(NFTFI_LOAN_ID)).to.equal(false);
      });
    });

    describe("#isLiquidated", async () => {
      it("returns true for liquidated loan", async () => {
        /* transaction 0x4242515898dcba7aab30796c2485b9b35de2ebd595f4150979b249a96facfc1e */
        expect(await noteAdapter.isLiquidated(15876)).to.equal(true);
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

  describe("ArcadeNoteAdapter", async () => {
    const LOAN_CORE = "0x81b2F8Fc75Bab64A6b144aa6d2fAa127B4Fa7fD9";
    const REPAYMENT_CONTROLLER = "0xb39dAB85FA05C381767FF992cCDE4c94619993d4";
    const VAULT_DEPOSIT_ROUTER = "0xFDda20a20cb4249e73e3356f468DdfdfB61483F6";

    const BORROWER_NOTE = "0x337104A4f06260Ff327d6734C555A0f5d8F863aa";
    const LENDER_NOTE = "0x349A026A43FFA8e2Ab4c4e59FCAa93F87Bd8DdeE";

    /* loanId and note tokenId are same on Arcade */
    const ARCADE_LOAN_ID = 872;

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

    /* loan details */
    let startDate: BigNumber;
    let terms: LoanTerms;

    /* borrower */
    let _borrower: string;

    before("deploy fixture", async () => {
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
});
