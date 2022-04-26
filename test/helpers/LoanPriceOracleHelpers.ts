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
  utilizationRateComponent: PiecewiseLinearModel;
  loanToValueRateComponent: PiecewiseLinearModel;
  durationRateComponent: PiecewiseLinearModel;
  rateComponentWeights: [number, number, number];
};

export function encodeCollateralParameters(collateralParameters: CollateralParameters): string {
  return ethers.utils.defaultAbiCoder.encode(
    [
      "tuple(uint256, tuple(uint256, uint256, uint256, uint256), tuple(uint256, uint256, uint256, uint256), tuple(uint256, uint256, uint256, uint256), uint16[3])",
    ],
    [
      [
        collateralParameters.collateralValue,
        [
          collateralParameters.utilizationRateComponent.slope1,
          collateralParameters.utilizationRateComponent.slope2,
          collateralParameters.utilizationRateComponent.target,
          collateralParameters.utilizationRateComponent.max,
        ],
        [
          collateralParameters.loanToValueRateComponent.slope1,
          collateralParameters.loanToValueRateComponent.slope2,
          collateralParameters.loanToValueRateComponent.target,
          collateralParameters.loanToValueRateComponent.max,
        ],
        [
          collateralParameters.durationRateComponent.slope1,
          collateralParameters.durationRateComponent.slope2,
          collateralParameters.durationRateComponent.target,
          collateralParameters.durationRateComponent.max,
        ],
        collateralParameters.rateComponentWeights,
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
