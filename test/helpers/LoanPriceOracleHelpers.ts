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
  rateUtilizationSensitivity: PiecewiseLinearModel;
  rateLoanToValueSensitivity: PiecewiseLinearModel;
  rateDurationSensitivity: PiecewiseLinearModel;
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
          collateralParameters.rateUtilizationSensitivity.slope1,
          collateralParameters.rateUtilizationSensitivity.slope2,
          collateralParameters.rateUtilizationSensitivity.target,
          collateralParameters.rateUtilizationSensitivity.max,
        ],
        [
          collateralParameters.rateLoanToValueSensitivity.slope1,
          collateralParameters.rateLoanToValueSensitivity.slope2,
          collateralParameters.rateLoanToValueSensitivity.target,
          collateralParameters.rateLoanToValueSensitivity.max,
        ],
        [
          collateralParameters.rateDurationSensitivity.slope1,
          collateralParameters.rateDurationSensitivity.slope2,
          collateralParameters.rateDurationSensitivity.target,
          collateralParameters.rateDurationSensitivity.max,
        ],
        collateralParameters.sensitivityWeights,
      ],
    ]
  );
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
