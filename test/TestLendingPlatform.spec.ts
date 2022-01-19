import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { TestERC20, TestERC721, TestLendingPlatform, TestNoteToken } from "../typechain";

import { extractEvent, expectEvent } from "./helpers/EventUtilities";

describe('TestLendingPlatform', function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let nft1: TestERC721;
  let lendingPlatform: TestLendingPlatform;
  let noteToken: TestNoteToken;
  let lastBlockTimestamp: number;

  beforeEach('create factories and deploy test tokens', async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory('TestERC20');
    const testERC721Factory = await ethers.getContractFactory('TestERC721');
    const testLendingPlatformFactory = await ethers.getContractFactory('TestLendingPlatform');
    const testNoteTokenFactory = await ethers.getContractFactory('TestNoteToken');

    tok1 = (await testERC20Factory.deploy("Token 1", "TOK1", ethers.utils.parseEther("1000"))) as TestERC20;
    await tok1.deployed();

    nft1 = (await testERC721Factory.deploy("NFT 1", "NFT1", "https://nft1.com/token/")) as TestERC721;
    await nft1.deployed();

    lendingPlatform = (await testLendingPlatformFactory.deploy(tok1.address)) as TestLendingPlatform;
    await lendingPlatform.deployed();

    noteToken = await ethers.getContractAt('TestNoteToken', await lendingPlatform.noteToken(), accounts[0]) as TestNoteToken;

    lastBlockTimestamp = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;
  })

  it('lend and repay', async function () {
    const borrower = accounts[1];
    const lender = accounts[2];
    const principal = ethers.utils.parseEther("10");
    const repayment = ethers.utils.parseEther("10.42");
    const duration = 30 * 86400;
    const collateralTokenId = 1234;

    /* Mint NFT to borrower */
    await nft1.mint(borrower.address, collateralTokenId);
    expect(await nft1.ownerOf(collateralTokenId)).to.equal(accounts[1].address);

    /* Approve lending platform to transfer NFT */
    await nft1.connect(borrower).setApprovalForAll(lendingPlatform.address, true);

    /* Approve lending platform to transfer token (for repayment) */
    await tok1.connect(borrower).approve(lendingPlatform.address, ethers.constants.MaxUint256);

    /* Transfer TOK1 to lender */
    await tok1.transfer(lender.address, principal);
    expect(await tok1.balanceOf(lender.address)).to.equal(principal);

    /* Approve lending platform to transfer token */
    await tok1.connect(lender).approve(lendingPlatform.address, ethers.constants.MaxUint256);

    /* Create a loan */
    const lendTx = await lendingPlatform.lend(borrower.address, lender.address, nft1.address, collateralTokenId, principal, repayment, duration);

    const loanId = (await extractEvent(lendTx, lendingPlatform.address, lendingPlatform, 'LoanCreated')).args.loanId;

    await expectEvent(lendTx, nft1.address, nft1, 'Transfer', {from: borrower.address, to: lendingPlatform.address, tokenId: collateralTokenId});
    await expectEvent(lendTx, tok1.address, tok1, 'Transfer', {from: lender.address, to: borrower.address, value: principal});
    await expectEvent(lendTx, noteToken.address, noteToken, 'Transfer', {from: ethers.constants.AddressZero, to: lender.address, tokenId: loanId});
    await expectEvent(lendTx, lendingPlatform.address, lendingPlatform, 'LoanCreated', {loanId: loanId, borrower: borrower.address, lender: lender.address});
    expect(await nft1.ownerOf(collateralTokenId)).to.equal(lendingPlatform.address);
    expect(await tok1.balanceOf(borrower.address)).to.equal(principal);
    expect(await tok1.balanceOf(lender.address)).to.equal(ethers.constants.Zero);
    expect(await noteToken.exists(loanId)).to.equal(true);
    expect(await noteToken.ownerOf(loanId)).to.equal(lender.address);

    /* Validate loan details */
    const loanTerms = await lendingPlatform.loans(loanId);
    expect(loanTerms.borrower).to.equal(borrower.address);
    expect(loanTerms.principal).to.equal(principal);
    expect(loanTerms.repayment).to.equal(repayment);
    expect(loanTerms.startTime).to.equal((await ethers.provider.getBlock(lendTx.blockHash!)).timestamp);
    expect(loanTerms.duration).to.equal(duration);
    expect(loanTerms.collateralToken).to.equal(nft1.address);
    expect(loanTerms.collateralTokenId).to.equal(1234);

    /* Check early liquidate fails */
    await expect(lendingPlatform.liquidate(loanId)).to.be.revertedWith("Loan not expired");

    /* Transfer interest to borrower */
    await tok1.transfer(borrower.address, repayment.sub(principal));

    /* Repay loan */
    const repayTx = await lendingPlatform.connect(borrower).repay(loanId);

    await expectEvent(repayTx, tok1.address, tok1, 'Transfer', {from: borrower.address, to: lender.address, value: repayment});
    await expectEvent(repayTx, nft1.address, nft1, 'Transfer', {from: lendingPlatform.address, to: borrower.address, tokenId: collateralTokenId});
    await expectEvent(repayTx, noteToken.address, noteToken, 'Transfer', {from: lender.address, to: ethers.constants.AddressZero, tokenId: loanId});
    await expectEvent(repayTx, lendingPlatform.address, lendingPlatform, 'LoanRepaid', {loanId: loanId});
    expect(await nft1.ownerOf(collateralTokenId)).to.equal(borrower.address);
    expect(await tok1.balanceOf(borrower.address)).to.equal(ethers.constants.Zero);
    expect(await tok1.balanceOf(lender.address)).to.equal(repayment);
    expect(await noteToken.exists(loanId)).to.equal(false);

    /* Check loan is complete */
    expect(await lendingPlatform.loansComplete(loanId)).to.equal(true);

    /* Check subsequent repayment fails */
    await expect(lendingPlatform.repay(loanId)).to.be.revertedWith("Unknown loan");
    /* Check subsequent liquidate fails */
    await expect(lendingPlatform.liquidate(loanId)).to.be.revertedWith("Unknown loan");
  });

  it('lend and liquidate', async function() {
    const borrower = accounts[1];
    const lender = accounts[2];
    const principal = ethers.utils.parseEther("10");
    const repayment = ethers.utils.parseEther("10.42");
    const duration = 30 * 86400;
    const collateralTokenId = 1234;

    /* Mint NFT to borrower */
    await nft1.mint(borrower.address, collateralTokenId);
    expect(await nft1.ownerOf(collateralTokenId)).to.equal(accounts[1].address);

    /* Approve lending platform to transfer NFT */
    await nft1.connect(borrower).setApprovalForAll(lendingPlatform.address, true);

    /* Transfer TOK1 to lender */
    await tok1.transfer(lender.address, principal);
    expect(await tok1.balanceOf(lender.address)).to.equal(principal);

    /* Approve lending platform to transfer token */
    await tok1.connect(lender).approve(lendingPlatform.address, ethers.constants.MaxUint256);

    /* Create a loan */
    const lendTx = await lendingPlatform.lend(borrower.address, lender.address, nft1.address, collateralTokenId, principal, repayment, duration);

    const loanId = (await extractEvent(lendTx, lendingPlatform.address, lendingPlatform, 'LoanCreated')).args.loanId;

    /* Check early liquidate fails */
    await expect(lendingPlatform.liquidate(loanId)).to.be.revertedWith("Loan not expired");

    /* Wait for loan expiration */
    const lendTimestamp = (await ethers.provider.getBlock(lendTx.blockHash!)).timestamp;
    await network.provider.send("evm_setNextBlockTimestamp", [lendTimestamp + duration + 1]);
    await network.provider.send("evm_mine");

    /* Liquidate loan */
    const liquidateTx = await lendingPlatform.liquidate(loanId);

    await expectEvent(liquidateTx, nft1.address, nft1, 'Transfer', {from: lendingPlatform.address, to: lender.address, tokenId: collateralTokenId});
    await expectEvent(liquidateTx, noteToken.address, noteToken, 'Transfer', {from: lender.address, to: ethers.constants.AddressZero, tokenId: loanId});
    await expectEvent(liquidateTx, lendingPlatform.address, lendingPlatform, 'LoanLiquidated', {loanId: loanId});
    expect(await nft1.ownerOf(collateralTokenId)).to.equal(lender.address);
    expect(await tok1.balanceOf(borrower.address)).to.equal(principal);
    expect(await tok1.balanceOf(lender.address)).to.equal(ethers.constants.Zero);
    expect(await noteToken.exists(loanId)).to.equal(false);

    /* Check loan is complete */
    expect(await lendingPlatform.loansComplete(loanId)).to.equal(true);

    /* Check subsequent liquidate fails */
    await expect(lendingPlatform.liquidate(loanId)).to.be.revertedWith("Unknown loan");
    /* Check subsequent repayment fails */
    await expect(lendingPlatform.repay(loanId)).to.be.revertedWith("Unknown loan");
  });
});

