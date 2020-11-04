//SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "lbp/interfaces/IERC20.sol";

import "../interfaces/ITreasury.sol";

import "@opengsn/gsn/contracts/interfaces/IRelayRecipient.sol";

contract CrecTransfer is IRelayRecipient, Ownable {

    int256 constant TREASURY_TARGET_PERIOD = 7 * 24 * 60 * 60; // 1 week

    // amount of money that should be in the treasury
    int128 public targetTreasuryBalance;

    // last amount of money that was in the treasury
    int128 laggingTreasuryBalance;

    // last fee that was charged
    uint128 lastFeeAmount;

    // last time fee was changed
    uint128 lastFeeChangeDate;

    // number of seconds between trade execution events
    uint32 public targetInterval;

    uint32 nextId = 1;

    address public treasury;

    mapping(address => uint256) public markedTime;
    mapping(address => address) public markedAddress;

    mapping(address => uint128) public tokenFee;

    mapping(uint32 => address) public idToAddress;
    mapping(address => uint32) public addressToId;

    event NewAuthorizedToken(address token);
    event NewRegistration(address addr, uint32 id);

    constructor(address _treasury, uint32 _targetInterval, int128 _targetTreasuryBalance) public {
        treasury = _treasury;
        targetInterval = _targetInterval;
        targetTreasuryBalance = _targetTreasuryBalance;
        laggingTreasuryBalance = targetTreasuryBalance;

        // try to target cost of a transfer transaction given current gas prices
        lastFeeAmount = 50000 * uint128(tx.gasprice);
    }

    function isTrustedForwarder(address forwarder) public override view returns(bool) {
        return forwarder == address(ITreasury(treasury).trustedForwarder());
    }

    /**
     * return the sender of this call.
     * if the call came through our trusted forwarder, return the original sender.
     * otherwise, return `msg.sender`.
     * should be used in the contract anywhere instead of msg.sender
     */
    function _msgSender() internal override(IRelayRecipient, Context) virtual view returns (address payable ret) {
        if (msg.data.length >= 24 && isTrustedForwarder(msg.sender)) {
            // At this point we know that the sender is a trusted forwarder,
            // so we trust that the last bytes of msg.data are the verified sender address.
            // extract sender address from the end of msg.data
            assembly {
                ret := shr(96,calldataload(sub(calldatasize(),20)))
            }
        } else {
            return msg.sender;
        }
    }

    /**
     * return the msg.data of this call.
     * if the call came through our trusted forwarder, then the real sender was appended as the last 20 bytes
     * of the msg.data - so this method will strip those 20 bytes off.
     * otherwise, return `msg.data`
     * should be used in the contract instead of msg.data, where the difference matters (e.g. when explicitly
     * signing or hashing the
     */
    function _msgData() internal override(IRelayRecipient, Context) virtual view returns (bytes memory ret) {
        if (msg.data.length >= 24 && isTrustedForwarder(msg.sender)) {
            // At this point we know that the sender is a trusted forwarder,
            // we copy the msg.data , except the last 20 bytes (and update the total length)
            assembly {
                let ptr := mload(0x40)
                // copy only size-20 bytes
                let size := sub(calldatasize(),20)
                // structure RLP data as <offset> <length> <bytes>
                mstore(ptr, 0x20)
                mstore(add(ptr,32), size)
                calldatacopy(add(ptr,64), 0, size)
                return(ptr, add(size,64))
            }
        } else {
            return msg.data;
        }
    }

    function versionRecipient() external override virtual view returns (string memory) {
        return "CrecTransfer";
    }

    function register(address addr) public {
        uint32 id = nextId++;
        require(nextId != 0, "next id overflow");

        idToAddress[id] = addr;
        addressToId[addr] = id;

        emit NewRegistration(addr, id);
    }

    function calculateTransferValue(address token, address payer) internal returns (address, uint256) {
        uint256 allowanceData = IERC20(token).allowance(payer, address(this));

        require(allowanceData > tokenFee[token], "ineligable allowance");

        uint32 idx = uint32(allowanceData >> 192);
        uint32 addressId = uint32(allowanceData >> 224);

        require(idToAddress[addressId] != address(0), "address not registered");
        address addr = idToAddress[addressId];

        require(idx > block.number, "block number is too high");

        return (addr, allowanceData & 0xffffffffffffffffffffffffffffffff);
    }

    function getReward(address token, uint count) internal view returns (uint256) {

        uint execTime = markedTime[token];
        require(execTime > 0, "not marked");

        uint curtime = block.timestamp;

        // calculate the base reward for a single address
        // reward should be = to tokenFee WHEN target process time is equal to now
        // reward should be = to 0 WHEN target process time is less than now
        uint reward = SafeMath.div(SafeMath.mul(curtime - markedTime[token], tokenFee[token]), targetInterval);

        // willingness to provide higher than fee is based on:
        // * number of pending trades

        reward *= count;

        return reward;
    }

    function addToken(address token) external onlyOwner {

        tokenFee[token] = lastFeeAmount;

        IERC20(token).approve(treasury, type(uint256).max);

        emit NewAuthorizedToken(token);
    }

    function updateFee(address addr) internal {

        int256 currentTreasuryBalance = int256(ITreasury(treasury).getTreasuryBalance());

        int256 deltaTreasuryBalance = int256(currentTreasuryBalance) - laggingTreasuryBalance;
        int256 deltaTime = int256(block.timestamp) - int256(lastFeeChangeDate);

        int256 balanceRatio = (currentTreasuryBalance * 1e7 / targetTreasuryBalance);
        int256 balanceSlope = (deltaTreasuryBalance * 1e7 / targetTreasuryBalance / deltaTime);

        int256 prediction = 1e7 - balanceRatio + TREASURY_TARGET_PERIOD * balanceSlope;

        uint128 newFee = uint128(lastFeeAmount + prediction);

        tokenFee[addr] = newFee;
        lastFeeAmount = newFee;
        lastFeeChangeDate = uint128(block.timestamp);

        laggingTreasuryBalance = int128(laggingTreasuryBalance + (currentTreasuryBalance - laggingTreasuryBalance) / 10);
    }

    /**
     * starts the timer for payouts for miners. The miner must provide a "payer" which has authorized some amount for this contract to spend
     * TODO: prevent mark after mark already has occured
     */
    function mark(address token, address payer) external {

        require(tokenFee[token] > 0, "not authorized token");

        (address _, uint spendAmount) = calculateTransferValue(token, payer);

        require(IERC20(token).balanceOf(payer) > spendAmount, "insufficient balance");

        markedTime[token] = block.timestamp;
        markedAddress[token] = payer;
    }

    function exec(address token, address[] calldata addrs) external {
        require(!isTrustedForwarder(msg.sender));

        IERC20 t = IERC20(token);

        uint transferFee = tokenFee[token];
        uint total = 0;

        address[] memory destAddrs = new address[](addrs.length);
        uint[] memory amounts = new uint[](addrs.length);

        for(uint i = 0;i < addrs.length;i++) {
            (address dest, uint amount) = calculateTransferValue(token, addrs[i]);

            total += amount;
            amounts[i] = amount;
            destAddrs[i] = dest;
        }

        uint fee = transferFee * addrs.length;
        t.transferFrom(addrs[0], address(this), fee);
        amounts[0] -= fee;

        ITreasury(treasury).deposit(token, address(this), fee);

        {
            uint i = addrs.length - 1;
            uint curTo = 0;
            uint dstRemaining = amounts[curTo] + fee - transferFee;
            uint srcRemaining = amounts[addrs.length - 1];
            while(i >= 0 && curTo < addrs.length - 1) {
                if(dstRemaining < srcRemaining) {
                    t.transferFrom(addrs[i], destAddrs[curTo], dstRemaining);

                    srcRemaining -= dstRemaining;
                    dstRemaining = amounts[++curTo] - transferFee;
                }
                else {
                    t.transferFrom(addrs[i], destAddrs[curTo], srcRemaining);
                    
                    dstRemaining -= srcRemaining;
                    srcRemaining = amounts[--i];
                }
            }

            require(srcRemaining == dstRemaining, "final transfer amount check");

            t.transferFrom(addrs[i], destAddrs[curTo], srcRemaining);
        }

        // send reward
        ITreasury(treasury).withdraw(ITreasury(treasury).getTreasuryToken(), msg.sender, getReward(token, addrs.length));

        // update fee
        updateFee(token);

        markedTime[token] = 0;
    }

    function uint256At(bytes memory data, uint256 location) internal pure returns (uint256 result) {
        assembly {
            result := mload(add(data, add(0x20, location)))
        }
    }

    function uint16At(bytes memory data, uint256 location) internal pure returns (uint16 result) {
        return uint16(uint256At(data, location) >> 240);
    }
}