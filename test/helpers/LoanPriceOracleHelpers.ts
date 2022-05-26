import { ethers } from "hardhat";

import { BigNumber } from "@ethersproject/bignumber";

export type PiecewiseLinearModel = {
  offset: BigNumber;
  slope1: BigNumber;
  slope2: BigNumber;
  target: BigNumber;
  max: BigNumber;
};

export type UtilizationParameters = PiecewiseLinearModel;

export type CollateralParameters = {
  active: boolean;
  loanToValueRateComponent: PiecewiseLinearModel;
  durationRateComponent: PiecewiseLinearModel;
  rateComponentWeights: [number, number, number];
};

export function encodeUtilizationParameters(utilizationParameters: PiecewiseLinearModel): string {
  return ethers.utils.defaultAbiCoder.encode(
    ["tuple(uint72, uint72, uint72, uint96, uint96)"],
    [
      [
        utilizationParameters.offset,
        utilizationParameters.slope1,
        utilizationParameters.slope2,
        utilizationParameters.target,
        utilizationParameters.max,
      ],
    ]
  );
}

export function encodeCollateralParameters(collateralParameters: CollateralParameters): string {
  return ethers.utils.defaultAbiCoder.encode(
    [
      "tuple(bool, tuple(uint72, uint72, uint72, uint96, uint96), tuple(uint72, uint72, uint72, uint96, uint96), uint16[3])",
    ],
    [
      [
        collateralParameters.active,
        [
          collateralParameters.loanToValueRateComponent.offset,
          collateralParameters.loanToValueRateComponent.slope1,
          collateralParameters.loanToValueRateComponent.slope2,
          collateralParameters.loanToValueRateComponent.target,
          collateralParameters.loanToValueRateComponent.max,
        ],
        [
          collateralParameters.durationRateComponent.offset,
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
    offset: parameters.minRate,
    slope1: parameters.targetRate.sub(parameters.minRate).mul(ethers.constants.WeiPerEther).div(parameters.target),
    slope2: parameters.maxRate
      .sub(parameters.targetRate)
      .mul(ethers.constants.WeiPerEther)
      .div(parameters.max.sub(parameters.target)),
    target: parameters.target,
    max: parameters.max,
  };
}
