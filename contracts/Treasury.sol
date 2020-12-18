//SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

// Needed to handle structures externally
pragma experimental ABIEncoderV2;

import "balancer-labs/contracts/ConfigurableRightsPool.sol";

import "@opengsn/gsn/contracts/interfaces/IPaymaster.sol";
import "@opengsn/gsn/contracts/interfaces/IRelayHub.sol";

import "./interfaces/ITreasury.sol";

//import "@openzeppelin/contracts/math/SafeMath.sol";

interface WETH {
    function deposit() external payable;
    function withdraw(uint wad) external;
}

/**
 * Modified balancer ConfigurableRightsPool which can be used for paying transaction minters for gas
 * Changes are:
 * * owner is authorized to spend and supply tokens at any time with no restrictions on pool tokens whatsoever
 * * OpenGSN compliant Paymaster
 * 
 * This contract currently barely fits under the deployment limit, so if strings are missing for reverts... that is why
 */
contract Treasury is ITreasury, ConfigurableRightsPool {
    //overhead of forwarder verify+signature, plus hub overhead.
    uint32 constant FORWARDER_HUB_OVERHEAD = 50000;

    //These parameters are documented in IPaymaster.GasLimits
    uint32 constant PRE_RELAYED_CALL_GAS_LIMIT = 100000;
    uint32 constant POST_RELAYED_CALL_GAS_LIMIT = 110000;
    uint32 constant PAYMASTER_ACCEPTANCE_BUDGET = PRE_RELAYED_CALL_GAS_LIMIT + FORWARDER_HUB_OVERHEAD;


    IRelayHub relayHub;

    IForwarder public override trustedForwarder;

    uint256 targetRelayHubDeposit;
    /*
     * modifier to be used by recipients as access control protection for preRelayedCall & postRelayedCall
     */
    modifier relayHubOnly() {
        require(msg.sender == address(relayHub));
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

    function getTreasuryToken()
        external override view
        returns (address)
    {
        return bPool.getCurrentTokens()[0];
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

    function setTrustedForwarder(address forwarder) public {
        trustedForwarder = IForwarder(forwarder);
    }

    /*function trustedForwarder() external override view returns (IForwarder) {
        return IForwarder(_trustedForwarder);
    }*/

    function setRelayHub(IRelayHub hub, uint256 targetDeposit) external onlyOwner {
        relayHub = hub;
        targetRelayHubDeposit = targetDeposit;

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
        return "a";
    }

    function fundPaymaster(uint256 spent) private needsBPool {

        require(address(relayHub) != address(0));

        uint256 refillAmt = spent + targetRelayHubDeposit - this.getRelayHubDeposit();

        WETH weth = WETH(bPool.getCurrentTokens()[0]);

        withdrawInternal(address(weth), address(this), refillAmt);

        weth.withdraw(refillAmt);

        relayHub.depositFor{value:refillAmt}(address(this));
    }
    

    /** hardhat seems to have a problem with anything inside this function. or something.
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
    needsBPool
    returns (bytes memory context, bool revertOnRecipientRevert) {
        (relayRequest, signature, approvalData, maxPossibleGas);

        // either paying owner, or a `permit` call to one of the supported erc20 tokens
        if(relayRequest.request.to != this.getController()) {
            // must be an address in this bpool
            require(bPool.isBound(relayRequest.request.to));

            bytes memory data = relayRequest.request.data;

            // must call permit
            require(data[0] == 0xd5 && 
                    data[1] == 0x05 &&
                    data[2] == 0xac &&
                    data[3] == 0xcf);

            // must permit our owner
            address spender;
            assembly {
                spender := mload(add(data, 0x124))
            }

            require(spender == this.getController());
        }

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

        //fundPaymaster(gasUseWithoutPost * relayData.gasPrice);
    }

}