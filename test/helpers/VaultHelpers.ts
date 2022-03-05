import { ethers, network } from "hardhat";

import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { extractEvent } from "./EventUtilities";

import { IERC721, TestERC20, TestERC721, TestLendingPlatform, MockLoanPriceOracle, Vault } from "../../typechain";

let _collateralTokenId = 1;

export async function initializeAccounts(
  borrower: SignerWithAddress,
  lender: SignerWithAddress,
  depositor: SignerWithAddress,
  liquidator: SignerWithAddress,
  nft: TestERC721,
  tok: TestERC20,
  lendingPlatform: TestLendingPlatform,
  vault: Vault
): Promise<void> {
  const initialAmount = ethers.utils.parseEther("1000");

  /* Transfer 1000 WETH to borrower */
  await tok.transfer(borrower.address, initialAmount);
  /* Transfer 1000 WETH to lender */
  await tok.transfer(lender.address, initialAmount);
  /* Transfer 1000 WETH to depositer */
  await tok.transfer(depositor.address, initialAmount);
  /* Transfer 1000 WETH to liquidator */
  await tok.transfer(liquidator.address, initialAmount);

  /* Approve token with lending platform for lender (for principal) */
  await tok.connect(lender).approve(lendingPlatform.address, ethers.constants.MaxUint256);

  /* Approve NFT with lending platform for borrower (for loan) */
  await nft.connect(borrower).setApprovalForAll(lendingPlatform.address, true);
  /* Approve token wiht lending platform for borrower (for repayment) */
  await tok.connect(borrower).approve(lendingPlatform.address, ethers.constants.MaxUint256);

  const noteToken = (await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC721/IERC721.sol:IERC721",
    await lendingPlatform.noteToken()
  )) as IERC721;

  /* Approve note token with vault for lender (for note sale) */
  await noteToken.connect(lender).setApprovalForAll(vault.address, true);

  /* Approve token with vault for depositor (for deposits) */
  await tok.connect(depositor).approve(vault.address, ethers.constants.MaxUint256);
}

export async function createLoan(
  lendingPlatform: TestLendingPlatform,
  nft: TestERC721,
  borrower: SignerWithAddress,
  lender: SignerWithAddress,
  principal: BigNumber,
  repayment: BigNumber,
  duration: number
): Promise<BigNumber> {
  const collateralTokenId = _collateralTokenId++;

  /* Mint NFT to borrower */
  await nft.mint(borrower.address, collateralTokenId);

  /* Create a loan */
  const lendTx = await lendingPlatform.lend(
    borrower.address,
    lender.address,
    nft.address,
    collateralTokenId,
    principal,
    repayment,
    duration
  );

  const loanId = (await extractEvent(lendTx, lendingPlatform, "LoanCreated")).args.loanId;

  return loanId;
}

export async function cycleLoan(
  lendingPlatform: TestLendingPlatform,
  mockLoanPriceOracle: MockLoanPriceOracle,
  vault: Vault,
  nft: TestERC721,
  borrower: SignerWithAddress,
  lender: SignerWithAddress,
  principal: BigNumber,
  repayment: BigNumber
): Promise<BigNumber> {
  const collateralTokenId = _collateralTokenId++;
  const duration = 30 * 86400;

  /* Mint NFT to borrower */
  await nft.mint(borrower.address, collateralTokenId);

  /* Create a loan */
  const lendTx = await lendingPlatform.lend(
    borrower.address,
    lender.address,
    nft.address,
    collateralTokenId,
    principal,
    repayment,
    duration
  );
  const loanId = (await extractEvent(lendTx, lendingPlatform, "LoanCreated")).args.loanId;

  /* Setup loan price with mock loan price oracle */
  await mockLoanPriceOracle.setPrice(principal);

  /* Sell note to vault */
  await vault.connect(lender).sellNote(await lendingPlatform.noteToken(), loanId, principal);

  /* Repay loan */
  await lendingPlatform.connect(borrower).repay(loanId, false);

  /* Callback vault */
  await vault.onLoanRepaid(await lendingPlatform.noteToken(), loanId);

  return loanId;
}

export async function cycleLoanDefault(
  lendingPlatform: TestLendingPlatform,
  mockLoanPriceOracle: MockLoanPriceOracle,
  vault: Vault,
  nft: TestERC721,
  borrower: SignerWithAddress,
  lender: SignerWithAddress,
  principal: BigNumber,
  repayment: BigNumber
): Promise<BigNumber> {
  const collateralTokenId = _collateralTokenId++;
  const duration = 30 * 86400;

  /* Mint NFT to borrower */
  await nft.mint(borrower.address, collateralTokenId);

  /* Create a loan */
  const lendTx = await lendingPlatform.lend(
    borrower.address,
    lender.address,
    nft.address,
    collateralTokenId,
    principal,
    repayment,
    duration
  );
  const loanId = (await extractEvent(lendTx, lendingPlatform, "LoanCreated")).args.loanId;

  /* Setup loan price with mock loan price oracle */
  await mockLoanPriceOracle.setPrice(principal);

  /* Sell note to vault */
  await vault.connect(lender).sellNote(await lendingPlatform.noteToken(), loanId, principal);

  /* Wait for loan to expire */
  await elapseTime(duration);

  /* Liquidate the loan */
  await lendingPlatform.liquidate(loanId);

  /* Callback vault */
  await vault.onLoanLiquidated(await lendingPlatform.noteToken(), loanId);

  return loanId;
}

export function randomAddress(): string {
  return ethers.utils.getAddress(ethers.utils.hexlify(ethers.utils.randomBytes(20)));
}

export async function getBlockTimestamp(): Promise<number> {
  return (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;
}

export async function elapseTime(duration: number): Promise<void> {
  const currentTimestamp = await getBlockTimestamp();
  await network.provider.send("evm_setNextBlockTimestamp", [currentTimestamp + duration + 1]);
  await network.provider.send("evm_mine");
}
