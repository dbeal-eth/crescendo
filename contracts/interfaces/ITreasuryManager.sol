//SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

interface ITreasuryManager {
    function getMaxSpend(bytes calldata) external returns (uint256);
}