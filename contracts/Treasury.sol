//SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

// Needed to handle structures externally
pragma experimental ABIEncoderV2;

import "@nomiclabs/buidler/console.sol";

import "lbp/contracts/ConfigurableRightsPool.sol";

import "./Treasury.sol";

import "@opengsn/gsn/contracts/interfaces/IPaymaster.sol";
import "@opengsn/gsn/contracts/interfaces/IRelayHub.sol";

import "./interfaces/ITreasury.sol";
import "./interfaces/ITreasuryManager.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";

interface WETH {
    function deposit() external payable;
    function withdraw(uint wad) external;
}

/**
 * Modified balancer ConfigurableRightsPool which can be used for paying transaction minters for gas
 * Changes are:
 * * owner is authorized to spend and supply tokens at any time with no restrictions on pool tokens whatsoever
 * * ability to add tokens in one step (this protocol has no use of time lock)
 * * ability to lock trading for single pair to accumulate tokens we desire over time
 */
contract Treasury is ITreasury, ConfigurableRightsPool {

    IRelayHub relayHub;

    uint256 constant public TARGET_RELAYHUB_DEPOSIT = 1e18;

    //overhead of forwarder verify+signature, plus hub overhead.
    uint256 constant public FORWARDER_HUB_OVERHEAD = 50000;

    //These parameters are documented in IPaymaster.GasLimits
    uint256 constant public PRE_RELAYED_CALL_GAS_LIMIT = 5000000;
    uint256 constant public POST_RELAYED_CALL_GAS_LIMIT = 6000000;
    uint256 constant public PAYMASTER_ACCEPTANCE_BUDGET = PRE_RELAYED_CALL_GAS_LIMIT + FORWARDER_HUB_OVERHEAD;
    /*
     * modifier to be used by recipients as access control protection for preRelayedCall & postRelayedCall
     */
    modifier relayHubOnly() {
        require(msg.sender == address(relayHub), "function can only be called by RelayHub");
        _;
    }

    constructor(
        address factoryAddress,
        ConfigurableRightsPool.PoolParams memory poolParams,
        RightsManager.Rights memory rightsParams
    )
        // solhint-disable-next-line visibility-modifier-order
        public
        ConfigurableRightsPool(factoryAddress, poolParams, rightsParams)
    {
    }


    function deposit(address token, address src, uint256 amt)
        external 
        override
        logs
        lock
        onlyOwner 
        needsBPool
        virtual {
        depositInternal(token, src, amt);
    }

    function depositInternal(address token, address src, uint256 amt) internal
        needsBPool {
        uint256 bal = bPool.getBalance(token);

        if(src != address(this))
            IERC20(token).transferFrom(src, address(this), amt);

        bPool.rebind(token, bal + amt, bPool.getDenormalizedWeight(token));
    }

    /**
     * Allows for contract owner to pull any funds from the pool whenever. No pool shares required.
     * Uses `rebind`.
     */
    function withdraw(address token, address dest, uint256 amt) 
        external
        override
        logs
        lock
        onlyOwner {
        withdrawInternal(token, dest, amt);
    }

    function withdrawInternal(address token, address dest, uint256 amt) internal
        needsBPool {
        uint256 bal = bPool.getBalance(token);

        bPool.rebind(token, bal - amt, bPool.getDenormalizedWeight(token));

        if(dest != address(this))
            IERC20(token).transfer(dest, amt);
    }

    function getBalance(address token)
        external override view
        returns (uint)
    {
        return bPool.getBalance(token);
    }

    function getTreasuryBalance()
        external override view
        returns (uint)
    {
        return bPool.getBalance(bPool.getCurrentTokens()[0]);
    }

    function getGasLimits()
    public
    override
    virtual
    view
    returns (
        IPaymaster.GasLimits memory limits
    ) {
        return IPaymaster.GasLimits(
            PAYMASTER_ACCEPTANCE_BUDGET,
            PRE_RELAYED_CALL_GAS_LIMIT,
            POST_RELAYED_CALL_GAS_LIMIT
        );
    }

    function trustedForwarder() external override view returns (IForwarder) {

    }

    function setRelayHub(IRelayHub hub) external onlyOwner {
        relayHub = hub;

        // send money to relayhub
        fundPaymaster(0);
    }

    function getHubAddr() external override view returns (address) {
        return address(relayHub);
    }

    function getRelayHubDeposit() external override view returns (uint256) {
        return relayHub.balanceOf(address(this));
    }

    function versionPaymaster() external override view returns (string memory) {
        return "Treasury v0.0.1";
    }

    function fundPaymaster(uint256 spent) private needsBPool {

        require(address(relayHub) != address(0), "relay hub address not set");

        uint256 refillAmt = spent + TARGET_RELAYHUB_DEPOSIT - this.getRelayHubDeposit();

        WETH weth = WETH(bPool.getCurrentTokens()[0]);

        withdrawInternal(address(weth), address(this), refillAmt);

        weth.withdraw(refillAmt);

        relayHub.depositFor{value:refillAmt}(address(this));
    }
    

    /** buidler seems to have a problem with anything inside this function. or something.
        so for now its empty. TODO */
    receive() external virtual payable {}

    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    virtual
    relayHubOnly
    returns (bytes memory context, bool revertOnRecipientRevert) {
        (relayRequest, signature, approvalData, maxPossibleGas);

        // make sure the caller is calling the owner
        require(relayRequest.request.to != this.getController(), "can only call owner");
        require(relayRequest.relayData.pctRelayFee == 0, "baseRelayFee only accepted");

        // TODO: need safe math here?
        uint256 maxSpend = maxPossibleGas * relayRequest.relayData.gasPrice + relayRequest.relayData.baseRelayFee;

        // make sure the owner thinks pay is good
        require(ITreasuryManager(this.getController()).getMaxSpend(relayRequest.request.data) >= maxSpend, "txn too expensive");

        return ("", true);
    }

    function postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    ) 
    external 
    override
    virtual
    relayHubOnly
    {
        (context, success, gasUseWithoutPost, relayData);

        fundPaymaster(gasUseWithoutPost * relayData.gasPrice);
    }

}