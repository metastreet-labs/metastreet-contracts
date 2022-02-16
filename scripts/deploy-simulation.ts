import { ethers, network } from "hardhat";

import { BigNumberish } from "@ethersproject/bignumber";

import { TestLendingPlatform } from "../typechain";
import { extractEvent } from "../test/helpers/EventUtilities";
import { TokenParameters, encodeTokenParameters, normalizeRate } from "../test/helpers/LoanPriceOracleHelpers";

async function main() {
  const accounts = await ethers.getSigners();
  console.log("Deploying from account #9 (%s)\n", accounts[9].address);

  const TestERC20 = await ethers.getContractFactory("TestERC20", accounts[9]);
  const TestERC721 = await ethers.getContractFactory("TestERC721", accounts[9]);
  const TestLendingPlatformFactory = await ethers.getContractFactory("TestLendingPlatform", accounts[9]);
  const TestNoteAdapter = await ethers.getContractFactory("TestNoteAdapter", accounts[9]);
  const LoanPriceOracle = await ethers.getContractFactory("LoanPriceOracle", accounts[9]);
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

  /* Deploy DAI Vault */
  const daiBlueChipVault = await Vault.deploy(
    "Blue Chip / DAI",
    "BC",
    daiTokenContract.address,
    daiLoanPriceOracle.address
  );
  await daiBlueChipVault.deployed();
  console.log("Blue Chip DAI Vault:    ", daiBlueChipVault.address);
  console.log("               Vault Name: ", await daiBlueChipVault.name());
  console.log(
    "   Senior LP Token Symbol: ",
    await (await ethers.getContractAt("IERC20Metadata", await daiBlueChipVault.lpToken(0))).symbol()
  );
  console.log("  Senior LP Token Address: ", await daiBlueChipVault.lpToken(0));
  console.log(
    "   Junior LP Token Symbol: ",
    await (await ethers.getContractAt("IERC20Metadata", await daiBlueChipVault.lpToken(1))).symbol()
  );
  console.log("  Senior LP Token Address: ", await daiBlueChipVault.lpToken(1));
  console.log("");

  /* Deploy WETH Vault */
  const wethBlueChipVault = await Vault.deploy(
    "Blue Chip / WETH",
    "BC",
    wethTokenContract.address,
    wethLoanPriceOracle.address
  );
  await wethBlueChipVault.deployed();
  console.log("Blue Chip WETH Vault:    ", wethBlueChipVault.address);
  console.log("               Vault Name: ", await wethBlueChipVault.name());
  console.log(
    "   Senior LP Token Symbol: ",
    await (await ethers.getContractAt("IERC20Metadata", await wethBlueChipVault.lpToken(0))).symbol()
  );
  console.log("  Senior LP Token Address: ", await wethBlueChipVault.lpToken(0));
  console.log(
    "   Junior LP Token Symbol: ",
    await (await ethers.getContractAt("IERC20Metadata", await wethBlueChipVault.lpToken(1))).symbol()
  );
  console.log("  Junior LP Token Address: ", await wethBlueChipVault.lpToken(1));
  console.log("");

  await daiBlueChipVault.setNoteAdapter(await daiTestLendingPlatform.noteToken(), daiTestNoteAdapter.address);
  console.log("Attached DAI Test Note Adapter to Blue Chip DAI Vault");

  await wethBlueChipVault.setNoteAdapter(await wethTestLendingPlatform.noteToken(), wethTestNoteAdapter.address);
  console.log("Attached WETH Test Note Adapter to Blue Chip WETH Vault");
  console.log("");

  console.log("Lender is   account #0 (%s)", accounts[0].address);
  console.log("Borrower is account #1 (%s)", accounts[1].address);
  console.log("");

  await daiTokenContract.transfer(accounts[0].address, ethers.utils.parseEther("1000"));
  console.log("Transferred 1000 DAI to account #0");

  await wethTokenContract.transfer(accounts[0].address, ethers.utils.parseEther("1000"));
  console.log("Transferred 1000 WETH to account #0");

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
  console.log("Approved WETH transfer for DAI Test Lending Platform for account #1");

  await daiTokenContract.connect(accounts[0]).approve(daiTestLendingPlatform.address, ethers.constants.MaxUint256);
  console.log("Approved DAI transfer for DAI Test Lending Platform for account #0");

  await wethTokenContract.connect(accounts[0]).approve(wethTestLendingPlatform.address, ethers.constants.MaxUint256);
  console.log("Approved DAI transfer for WETH Test Lending Platform for account #0");

  console.log("");

  /* Setup token parameters for loan price oracles */
  const tokenParameters: TokenParameters[] = [
    {
      duration: 30 * 86400,
      minDiscountRate: normalizeRate("0.25"),
      aprSensitivity: normalizeRate("0.00010"),
      minPurchasePrice: ethers.utils.parseEther("100"),
      maxPurchasePrice: ethers.utils.parseEther("1000"),
    },
    {
      duration: 60 * 86400,
      minDiscountRate: normalizeRate("0.35"),
      aprSensitivity: normalizeRate("0.00025"),
      minPurchasePrice: ethers.utils.parseEther("100"),
      maxPurchasePrice: ethers.utils.parseEther("1000"),
    },
    {
      duration: 90 * 86400,
      minDiscountRate: normalizeRate("0.60"),
      aprSensitivity: normalizeRate("0.00050"),
      minPurchasePrice: ethers.utils.parseEther("100"),
      maxPurchasePrice: ethers.utils.parseEther("1000"),
    },
  ];

  await daiLoanPriceOracle.setTokenParameters(baycTokenContract.address, encodeTokenParameters(tokenParameters));
  console.log("Setup BAYC token parameters for DAI Loan Price Oracle");

  await wethLoanPriceOracle.setTokenParameters(baycTokenContract.address, encodeTokenParameters(tokenParameters));
  console.log("Setup BAYC token parameters for WETH Loan Price Oracle");

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
    ethers.utils.parseEther("100"),
    ethers.utils.parseEther("120"),
    30 * 86400
  );
  console.log("Created DAI Loan ID %s:  Borrower account #1, Lender account #0,", loanId);
  console.log("                        Principal 10 DAI, Repayment 10.42 DAI, Duration 30 days,");
  console.log("                        Collateral Token ID 123\n");

  /* Fast-forward time by 15 days */
  const lastBlockTimestamp = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;
  await network.provider.send("evm_setNextBlockTimestamp", [lastBlockTimestamp + 15 * 86400]);
  await network.provider.send("evm_mine");
  console.log("Fast-forwarded time by 15 days\n");

  loanId = await createLoan(
    wethTestLendingPlatform,
    baycTokenContract.address,
    456,
    ethers.utils.parseEther("200"),
    ethers.utils.parseEther("215"),
    30 * 86400
  );
  console.log("Created WETH Loan ID %s: Borrower account #1, Lender account #0,", loanId);
  console.log("                        Principal 30 WETH, Repayment 30.12 WETH, Duration 30 days,");
  console.log("                        Collateral Token ID 456\n");

  loanId = await createLoan(
    wethTestLendingPlatform,
    baycTokenContract.address,
    768,
    ethers.utils.parseEther("150"),
    ethers.utils.parseEther("195"),
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
