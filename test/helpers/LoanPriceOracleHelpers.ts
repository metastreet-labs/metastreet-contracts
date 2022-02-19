import { ethers } from "hardhat";

import { BigNumber } from "@ethersproject/bignumber";

export type PiecewiseLinearModel = {
  slope1: BigNumber;
  slope2: BigNumber;
  target: BigNumber;
  max: BigNumber;
};

export type CollateralParameters = {
  collateralValue: BigNumber;
  aprUtilizationSensitivity: PiecewiseLinearModel;
  aprLoanToValueSensitivity: PiecewiseLinearModel;
  aprDurationSensitivity: PiecewiseLinearModel;
  sensitivityWeights: [number, number, number];
};

export function encodeCollateralParameters(collateralParameters: CollateralParameters): string {
  return ethers.utils.defaultAbiCoder.encode(
    [
      "tuple(uint256, tuple(uint256, uint256, uint256, uint256), tuple(uint256, uint256, uint256, uint256), tuple(uint256, uint256, uint256, uint256), uint8[3])",
    ],
    [
      [
        collateralParameters.collateralValue,
        [
          collateralParameters.aprUtilizationSensitivity.slope1,
          collateralParameters.aprUtilizationSensitivity.slope2,
          collateralParameters.aprUtilizationSensitivity.target,
          collateralParameters.aprUtilizationSensitivity.max,
        ],
        [
          collateralParameters.aprLoanToValueSensitivity.slope1,
          collateralParameters.aprLoanToValueSensitivity.slope2,
          collateralParameters.aprLoanToValueSensitivity.target,
          collateralParameters.aprLoanToValueSensitivity.max,
        ],
        [
          collateralParameters.aprDurationSensitivity.slope1,
          collateralParameters.aprDurationSensitivity.slope2,
          collateralParameters.aprDurationSensitivity.target,
          collateralParameters.aprDurationSensitivity.max,
        ],
        collateralParameters.sensitivityWeights,
      ],
    ]
  );
}

export function normalizeRate(rate: string): BigNumber {
  return ethers.utils.parseEther(rate).div(365 * 86400);
}

export function computePiecewiseLinearModel(parameters: {
  minRate: BigNumber;
  targetRate: BigNumber;
  maxRate: BigNumber;
  target: BigNumber;
  max: BigNumber;
}): PiecewiseLinearModel {
  return {
    slope1: parameters.targetRate.sub(parameters.minRate).mul(ethers.constants.WeiPerEther).div(parameters.target),
    slope2: parameters.maxRate
      .sub(parameters.targetRate)
      .mul(ethers.constants.WeiPerEther)
      .div(parameters.max.sub(parameters.target)),
    target: parameters.target,
    max: parameters.max,
  };
}
