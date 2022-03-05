import { ethers } from "hardhat";

import { BigNumber } from "@ethersproject/bignumber";

export class DeterministicRandom {
  static async randomBigNumber(): Promise<BigNumber> {
    return ethers.BigNumber.from(await ethers.utils.id((await ethers.provider.getBlockNumber()).toString()));
  }

  static async randomNumber(): Promise<number> {
    return (await DeterministicRandom.randomBigNumber()).mod(2 ** 32).toNumber() / 2 ** 32;
  }

  static async randomNumberRange(min: number, max: number): Promise<number> {
    return (await DeterministicRandom.randomNumber()) * (max - min) + min;
  }

  static async randomBigNumberRange(min: BigNumber, max: BigNumber): Promise<BigNumber> {
    return (await DeterministicRandom.randomBigNumber()).mod(max.sub(min)).add(min);
  }
}
