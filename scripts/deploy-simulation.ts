import { ethers } from "hardhat";

import { BigNumberish } from "@ethersproject/bignumber";

import { TestLendingPlatform } from "../typechain";
import { extractEvent } from "../test/helpers/EventUtilities";
import { elapseTime } from "../test/helpers/VaultHelpers";
import { FixedPoint } from "../test/helpers/FixedPointHelpers";
import {
  CollateralParameters,
  encodeCollateralParameters,
  computePiecewiseLinearModel,
} from "../test/helpers/LoanPriceOracleHelpers";

async function main() {
  const accounts = await ethers.getSigners();
  console.log("Deploying from account #9 (%s)\n", accounts[9].address);

  const TestERC20 = await ethers.getContractFactory("TestERC20", accounts[9]);
  const TestERC721 = await ethers.getContractFactory("TestERC721", accounts[9]);
  const TestLendingPlatformFactory = await ethers.getContractFactory("TestLendingPlatform", accounts[9]);
  const TestNoteAdapter = await ethers.getContractFactory("TestNoteAdapter", accounts[9]);
  const LoanPriceOracle = await ethers.getContractFactory("LoanPriceOracle", accounts[9]);
  const LPToken = await ethers.getContractFactory("LPToken", accounts[9]);
  const Vault = await ethers.getContractFactory("Vault", accounts[9]);

  /* Deploy DAI */
  const daiTokenContract = await TestERC20.deploy("DAI", "DAI", ethers.utils.parseEther("1000000"));
  await daiTokenContract.deployed();
  console.log("DAI Token Contract:     ", daiTokenContract.address);

  /* Deploy WETH */
  const wethTokenContract = await TestERC20.deploy("WETH", "WETH", ethers.utils.parseEther("1000000"));
  await wethTokenContract.deployed();
  console.log("WETH Token Contract:    ", wethTokenContract.address);

  /* Deploy BAYC */
  const baycTokenContract = await TestERC721.deploy(
    "BoredApeYachtClub",
    "BAYC",
    "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/"
  );
  await baycTokenContract.deployed();
  console.log("BAYC Token Contract:    ", baycTokenContract.address);

  console.log("");

  /* Deploy DAI Test Lending Platform */
  const daiTestLendingPlatform = await TestLendingPlatformFactory.deploy(daiTokenContract.address);
  await daiTestLendingPlatform.deployed();
  console.log("DAI Lending Platform:   ", daiTestLendingPlatform.address);
  console.log("       Note Token Address: ", await daiTestLendingPlatform.noteToken());
  console.log("");

  /* Deploy WETH Test Lending Platform */
  const wethTestLendingPlatform = await TestLendingPlatformFactory.deploy(wethTokenContract.address);
  await wethTestLendingPlatform.deployed();
  console.log("WETH Lending Platform:  ", wethTestLendingPlatform.address);
  console.log("       Note Token Address: ", await wethTestLendingPlatform.noteToken());
  console.log("");

  /* Deploy DAI Test Note Adapter */
  const daiTestNoteAdapter = await TestNoteAdapter.deploy(daiTestLendingPlatform.address);
  await daiTestNoteAdapter.deployed();

  /* Deploy WETH Test Note Adapter */
  const wethTestNoteAdapter = await TestNoteAdapter.deploy(wethTestLendingPlatform.address);
  await wethTestNoteAdapter.deployed();

  /* Deploy Loan Price Oracle for DAI */
  const daiLoanPriceOracle = await LoanPriceOracle.deploy(daiTokenContract.address);
  await daiLoanPriceOracle.deployed();
  console.log("DAI Loan Price Oracle:  ", daiLoanPriceOracle.address);

  /* Deploy Loan Price Oracle for WETH */
  const wethLoanPriceOracle = await LoanPriceOracle.deploy(wethTokenContract.address);
  await wethLoanPriceOracle.deployed();
  console.log("WETH Loan Price Oracle: ", wethLoanPriceOracle.address);

  console.log("");

  /* Deploy DAI Vault Senior LP token */
  const daiBlueChipVaultSeniorLPToken = await LPToken.deploy();
  await daiBlueChipVaultSeniorLPToken.deployed();
  await daiBlueChipVaultSeniorLPToken.initialize("Senior LP Token", "msLP-BC-DAI");

  /* Deploy DAI Vault Junior LP token */
  const daiBlueChipVaultJuniorLPToken = await LPToken.deploy();
  await daiBlueChipVaultJuniorLPToken.deployed();
  await daiBlueChipVaultJuniorLPToken.initialize("Junior LP Token", "mjLP-BC-DAI");

  /* Deploy DAI Vault */
  const daiBlueChipVault = await Vault.deploy();
  await daiBlueChipVault.deployed();
  await daiBlueChipVault.initialize(
    "Blue Chip / DAI",
    daiTokenContract.address,
    daiLoanPriceOracle.address,
    daiBlueChipVaultSeniorLPToken.address,
    daiBlueChipVaultJuniorLPToken.address
  );
  await daiBlueChipVault.deployed();

  /* Transfer ownership of LP tokens to DAI Vault */
  await daiBlueChipVaultSeniorLPToken.transferOwnership(daiBlueChipVault.address);
  await daiBlueChipVaultJuniorLPToken.transferOwnership(daiBlueChipVault.address);

  console.log("Blue Chip DAI Vault:    ", daiBlueChipVault.address);
  console.log("               Vault Name: ", await daiBlueChipVault.name());
  console.log(
    "   Senior LP Token Symbol: ",
    await (await ethers.getContractAt("IERC20Metadata", daiBlueChipVaultSeniorLPToken.address)).symbol()
  );
  console.log("  Senior LP Token Address: ", daiBlueChipVaultSeniorLPToken.address);
  console.log(
    "   Junior LP Token Symbol: ",
    await (await ethers.getContractAt("IERC20Metadata", daiBlueChipVaultJuniorLPToken.address)).symbol()
  );
  console.log("  Junior LP Token Address: ", daiBlueChipVaultSeniorLPToken.address);
  console.log("");

  /* Deploy WETH Vault Senior LP token */
  const wethBlueChipVaultSeniorLPToken = await LPToken.deploy();
  await wethBlueChipVaultSeniorLPToken.deployed();
  await wethBlueChipVaultSeniorLPToken.initialize("Senior LP Token", "msLP-BC-WETH");

  /* Deploy WETH Vault Junior LP token */
  const wethBlueChipVaultJuniorLPToken = await LPToken.deploy();
  await wethBlueChipVaultJuniorLPToken.deployed();
  await wethBlueChipVaultJuniorLPToken.initialize("Junior LP Token", "mjLP-BC-WETH");

  /* Deploy WETH Vault */
  const wethBlueChipVault = await Vault.deploy();
  await wethBlueChipVault.deployed();
  await wethBlueChipVault.initialize(
    "Blue Chip / WETH",
    wethTokenContract.address,
    wethLoanPriceOracle.address,
    wethBlueChipVaultSeniorLPToken.address,
    wethBlueChipVaultJuniorLPToken.address
  );
  await wethBlueChipVault.deployed();

  /* Transfer ownership of LP tokens to WETH Vault */
  await wethBlueChipVaultSeniorLPToken.transferOwnership(wethBlueChipVault.address);
  await wethBlueChipVaultJuniorLPToken.transferOwnership(wethBlueChipVault.address);

  console.log("Blue Chip WETH Vault:    ", wethBlueChipVault.address);
  console.log("               Vault Name: ", await wethBlueChipVault.name());
  console.log(
    "   Senior LP Token Symbol: ",
    await (await ethers.getContractAt("IERC20Metadata", wethBlueChipVaultSeniorLPToken.address)).symbol()
  );
  console.log("  Senior LP Token Address: ", wethBlueChipVaultSeniorLPToken.address);
  console.log(
    "   Junior LP Token Symbol: ",
    await (await ethers.getContractAt("IERC20Metadata", wethBlueChipVaultJuniorLPToken.address)).symbol()
  );
  console.log("  Junior LP Token Address: ", wethBlueChipVaultJuniorLPToken.address);
  console.log("");

  await daiBlueChipVault.setReserveRatio(FixedPoint.from("0.10"));
  console.log("Set 10% Reserve Ratio on Blue Chip DAI Vault");

  await wethBlueChipVault.setReserveRatio(FixedPoint.from("0.15"));
  console.log("Set 15% Reserve Ratio on Blue Chip WETH Vault");
  console.log("");

  await daiBlueChipVault.setNoteAdapter(await daiTestLendingPlatform.noteToken(), daiTestNoteAdapter.address);
  console.log("Attached DAI Test Note Adapter to Blue Chip DAI Vault");

  await wethBlueChipVault.setNoteAdapter(await wethTestLendingPlatform.noteToken(), wethTestNoteAdapter.address);
  console.log("Attached WETH Test Note Adapter to Blue Chip WETH Vault");
  console.log("");

  console.log("Lender is      account #0 (%s)", accounts[0].address);
  console.log("Borrower is    account #1 (%s)", accounts[1].address);
  console.log("Depositer 1 is account #2 (%s)", accounts[2].address);
  console.log("Depositer 2 is account #3 (%s)", accounts[3].address);
  console.log("");

  await daiTokenContract.transfer(accounts[0].address, ethers.utils.parseEther("1000"));
  await daiTokenContract.transfer(accounts[1].address, ethers.utils.parseEther("1000"));
  await daiTokenContract.transfer(accounts[2].address, ethers.utils.parseEther("1000"));
  await daiTokenContract.transfer(accounts[3].address, ethers.utils.parseEther("1000"));
  console.log("Transferred 1000 DAI to account #0, #1, #2, #3");

  await wethTokenContract.transfer(accounts[0].address, ethers.utils.parseEther("1000"));
  await wethTokenContract.transfer(accounts[1].address, ethers.utils.parseEther("1000"));
  await wethTokenContract.transfer(accounts[2].address, ethers.utils.parseEther("1000"));
  await wethTokenContract.transfer(accounts[3].address, ethers.utils.parseEther("1000"));
  console.log("Transferred 1000 WETH to account #0, #1, #2, #3");

  await baycTokenContract.mint(accounts[1].address, 123);
  await baycTokenContract.mint(accounts[1].address, 456);
  await baycTokenContract.mint(accounts[1].address, 768);
  console.log("Minted BAYC #123, #456, #768 to account #1");

  await baycTokenContract.connect(accounts[1]).setApprovalForAll(daiTestLendingPlatform.address, true);
  console.log("Approved BAYC transfer for DAI Test Lending Platform for account #1");

  await baycTokenContract.connect(accounts[1]).setApprovalForAll(wethTestLendingPlatform.address, true);
  console.log("Approved BAYC transfer for WETH Test Lending Platform for account #1");

  await daiTokenContract.connect(accounts[1]).approve(daiTestLendingPlatform.address, ethers.constants.MaxUint256);
  console.log("Approved DAI transfer for DAI Test Lending Platform for account #1");

  await wethTokenContract.connect(accounts[1]).approve(wethTestLendingPlatform.address, ethers.constants.MaxUint256);
  console.log("Approved WETH transfer for WETH Test Lending Platform for account #1");

  await daiTokenContract.connect(accounts[0]).approve(daiTestLendingPlatform.address, ethers.constants.MaxUint256);
  console.log("Approved DAI transfer for DAI Test Lending Platform for account #0");

  await wethTokenContract.connect(accounts[0]).approve(wethTestLendingPlatform.address, ethers.constants.MaxUint256);
  console.log("Approved DAI transfer for WETH Test Lending Platform for account #0");

  console.log("");

  /* Setup collateral parameters for loan price oracles */
  const minimumDiscountRate = FixedPoint.normalizeRate("0.05");

  const collateralParameters: CollateralParameters = {
    collateralValue: ethers.utils.parseEther("100"),
    utilizationRateComponent: computePiecewiseLinearModel({
      minRate: FixedPoint.normalizeRate("0.05"),
      targetRate: FixedPoint.normalizeRate("0.10"),
      maxRate: FixedPoint.normalizeRate("2.00"),
      target: FixedPoint.from("0.90"),
      max: FixedPoint.from("1.00"),
    }),
    loanToValueRateComponent: computePiecewiseLinearModel({
      minRate: FixedPoint.normalizeRate("0.05"),
      targetRate: FixedPoint.normalizeRate("0.10"),
      maxRate: FixedPoint.normalizeRate("2.00"),
      target: FixedPoint.from("0.30"),
      max: FixedPoint.from("0.60"),
    }),
    durationRateComponent: computePiecewiseLinearModel({
      minRate: FixedPoint.normalizeRate("0.05"),
      targetRate: FixedPoint.normalizeRate("0.10"),
      maxRate: FixedPoint.normalizeRate("2.00"),
      target: ethers.BigNumber.from(30 * 86400).mul(ethers.constants.WeiPerEther),
      max: ethers.BigNumber.from(90 * 86400).mul(ethers.constants.WeiPerEther),
    }),
    rateComponentWeights: [50, 25, 25],
  };

  await daiLoanPriceOracle.setMinimumDiscountRate(minimumDiscountRate);
  await daiLoanPriceOracle.setCollateralParameters(
    baycTokenContract.address,
    encodeCollateralParameters(collateralParameters)
  );
  console.log("Setup BAYC collateral parameters for DAI Loan Price Oracle");

  await wethLoanPriceOracle.setMinimumDiscountRate(minimumDiscountRate);
  await wethLoanPriceOracle.setCollateralParameters(
    baycTokenContract.address,
    encodeCollateralParameters(collateralParameters)
  );
  console.log("Setup BAYC collateral parameters for WETH Loan Price Oracle");

  console.log("");

  async function createLoan(
    lendingPlatform: TestLendingPlatform,
    collateralTokenAddress: string,
    collateralTokenId: number,
    principal: BigNumberish,
    repayment: BigNumberish,
    duration: number
  ): Promise<BigNumberish> {
    const lendTx = await lendingPlatform.lend(
      accounts[1].address,
      accounts[0].address,
      collateralTokenAddress,
      collateralTokenId,
      principal,
      repayment,
      duration
    );
    return (await extractEvent(lendTx, lendingPlatform, "LoanCreated")).args.loanId;
  }

  let loanId: BigNumberish;

  loanId = await createLoan(
    daiTestLendingPlatform,
    baycTokenContract.address,
    123,
    ethers.utils.parseEther("30"),
    ethers.utils.parseEther("33"),
    30 * 86400
  );
  console.log("Created DAI Loan ID %s:  Borrower account #1, Lender account #0,", loanId);
  console.log("                        Principal 10 DAI, Repayment 10.42 DAI, Duration 30 days,");
  console.log("                        Collateral Token ID 123\n");

  /* Fast-forward time by 15 days */
  await elapseTime(15 * 86400);
  console.log("Fast-forwarded time by 15 days\n");

  loanId = await createLoan(
    wethTestLendingPlatform,
    baycTokenContract.address,
    456,
    ethers.utils.parseEther("20"),
    ethers.utils.parseEther("21"),
    30 * 86400
  );
  console.log("Created WETH Loan ID %s: Borrower account #1, Lender account #0,", loanId);
  console.log("                        Principal 30 WETH, Repayment 30.12 WETH, Duration 30 days,");
  console.log("                        Collateral Token ID 456\n");

  loanId = await createLoan(
    wethTestLendingPlatform,
    baycTokenContract.address,
    768,
    ethers.utils.parseEther("15"),
    ethers.utils.parseEther("16"),
    60 * 86400
  );
  console.log("Created WETH Loan ID %s: Borrower account #1, Lender account #0,", loanId);
  console.log("                        Principal 15 WETH, Repayment 15.85 WETH, Duration 60 days,");
  console.log("                        Collateral Token ID 768");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
