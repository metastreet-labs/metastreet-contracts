import { ethers } from "hardhat";

import { BigNumber } from "@ethersproject/bignumber";

export type TokenParameters = {
  duration: number;
  minDiscountRate: BigNumber;
  aprSensitivity: BigNumber;
  minPurchasePrice: BigNumber;
  maxPurchasePrice: BigNumber;
};

export function encodeTokenParameters(tokenParameters: TokenParameters[]): string {
  return ethers.utils.defaultAbiCoder.encode(
    ["tuple(uint256, tuple(uint256, uint256, uint256, uint256))[]"],
    [
      tokenParameters.map((p) => [
        p.duration,
        [p.minDiscountRate, p.aprSensitivity, p.minPurchasePrice, p.maxPurchasePrice],
      ]),
    ]
  );
}

export function normalizeRate(rate: string): BigNumber {
  return ethers.utils.parseEther(rate).div(365 * 86400);
}
