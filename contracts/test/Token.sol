//SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

import "@nomiclabs/buidler/console.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * Basic token only for testing
 */
contract Token is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialBalance) ERC20(name, symbol) public {
        _mint(msg.sender, initialBalance);
    }
}