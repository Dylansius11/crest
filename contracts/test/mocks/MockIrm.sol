// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Market, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";

contract MockIrm {
    uint256 public borrowRatePerSecondWad;

    function setBorrowRatePerSecondWad(uint256 newRate) external {
        borrowRatePerSecondWad = newRate;
    }

    function borrowRateView(MarketParams calldata, Market calldata) external view returns (uint256) {
        return borrowRatePerSecondWad;
    }

    function borrowRate(MarketParams calldata, Market calldata) external view returns (uint256) {
        return borrowRatePerSecondWad;
    }
}
