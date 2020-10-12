// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.6.12;

// Needed to handle structures externally
pragma experimental ABIEncoderV2;

// Imports
import "./Treasury.sol";

// Contracts

/**
 * @author klbyte
 * @title Configurable Rights Pool Treasury Factory - create pool of tokens for a treasury
 */
contract CRPTreasuryFactory {
    // State variables

    // Keep a list of all Elastic Supply Pools
    mapping(address => bool) private _isTreasury;

    // Event declarations

    // Log the address of each new smart pool, and its creator
    event LogNewTreasury(
        address indexed caller,
        address indexed pool
    );

    // Function declarations

    /**
     * @notice Create a new treasury
     * @dev emits a LogNewTreasury event
     * @param factoryAddress - the BFactory instance used to create the underlying pool
     * @param poolParams - CRP pool parameters
     * @param rights - struct of permissions, configuring this CRP instance (see above for definitions)
     */
    function newTreasury(
        address factoryAddress,
        ConfigurableRightsPool.PoolParams calldata poolParams,
        RightsManager.Rights calldata rights
    )
        external
        returns (Treasury)
    {
        require(poolParams.constituentTokens.length >= BalancerConstants.MIN_ASSET_LIMIT, "ERR_TOO_FEW_TOKENS");

        // Arrays must be parallel
        require(poolParams.tokenBalances.length == poolParams.constituentTokens.length, "ERR_START_BALANCES_MISMATCH");
        require(poolParams.tokenWeights.length == poolParams.constituentTokens.length, "ERR_START_WEIGHTS_MISMATCH");

        Treasury t = new Treasury(
            factoryAddress,
            poolParams,
            rights
        );

        emit LogNewTreasury(msg.sender, address(t));

        _isTreasury[address(t)] = true;
        t.setController(msg.sender);

        return t;
    }

    /**
     * @notice Check to see if a given address is a treasury
     * @param addr - address to check
     * @return boolean indicating whether it is a treasury
     */
    function isTreasury(address addr) external view returns (bool) {
        return _isTreasury[addr];
    }
}