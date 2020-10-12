//SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

pragma experimental ABIEncoderV2;

import "@opengsn/gsn/contracts/interfaces/IPaymaster.sol";

interface ITreasury is IPaymaster {
    function getBalance(address token) external view returns (uint);
    function getTreasuryBalance() external view returns (uint);

    function deposit(address token, address src, uint256 amt) external;
    function withdraw(address token, address dest, uint256 amt)  external;
}