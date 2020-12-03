//SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

import "hardhat/console.sol";

import "lbp/interfaces/IERC20.sol";

import "../Crescendo.sol";

import "../interfaces/ITreasury.sol";

contract CrecTransfer is Crescendo {

    mapping(uint32 => address) public idToAddress;
    mapping(address => uint32) public addressToId;

    // next ID to use on addAuthorizedPair
    uint16 nextId = 1;
    uint16 nextAddrId = 1;

    // uniswap pairs which may be exchanged by this contract
    mapping(uint16 => address) public authorizedTokens;

    event NewRegistration(address addr, uint32 id);

    constructor(address _treasury, uint32 _targetInterval, uint128 _targetTreasuryBalance) public {
        treasury = _treasury;
        targetInterval = _targetInterval;
        targetTreasuryBalance = _targetTreasuryBalance;
    }

    function addAuthorizedToken(address token, uint128 startFee) external onlyOwner {

        authorizedTokens[nextId] = token;

        opInfo[nextId] = OpInfo(uint128(startFee), uint128(block.timestamp));
        nextId = nextId + 1;

        IERC20(token).approve(treasury, type(uint256).max);

        emit NewAuthorizedOp(nextId - 1, token, address(0), address(0));
    }

    function register(address addr) public {
        uint32 id = nextAddrId++;
        require(nextAddrId != 0, "next id overflow");

        idToAddress[id] = addr;
        addressToId[addr] = id;

        emit NewRegistration(addr, id);
    }

    function calculateOpId(uint256 amt) public pure override returns (uint16) {
        return uint16(amt >> 176);
    }

    function calculateApproveValue(address addr, uint16 id, address payer) public view override returns (uint256) {
        (uint amt, address _) = calculateApproveValueInternal(addr, id, payer);

        return amt;
    }

    function calculateApproveValueInternal(address addr, uint16 id, address payer) internal view returns (uint256, address) {
        address token = authorizedTokens[id];

        uint256 allowanceData = IERC20(token).allowance(payer, address(this));

        uint128 amt = uint128(allowanceData);
        uint32 deadline = uint16(allowanceData >> 192);

        if(amt <= opInfo[id].fee ||                                              // not enough transfer to cover fee + payload
            calculateOpId(allowanceData) != id ||                                // op id should match token
            idToAddress[uint32(allowanceData >> 224)] == address(0) ||           // destination address id is not registered
            deadline <= block.number) {                                          // block deadline has passed, transaction no longer valid
            return (0, address(0));
        }

        return (amt, idToAddress[uint32(allowanceData >> 224)] );
    }

    function calculateDestinationAddress(uint256 allowanceData) public view returns (address) {
        uint32 addressId = uint32(allowanceData >> 224);

        return idToAddress[addressId];
    }

    function getReward(uint16 id, uint count) public view override returns (uint256) {
        return getRewardInternal(id, count);
    }

    function getRewardInternal(uint16 pair, uint count) internal view returns (uint256) {
        OpInfo memory info = opInfo[pair];

        uint curtime = block.timestamp;

        // calculate the base reward for a single address
        // reward should be = to opFee WHEN target process time is equal to now
        // reward should be = to 0 WHEN target process time is less than now
        uint reward = SafeMath.div(SafeMath.mul(curtime - info.lastTime, info.fee), targetInterval);

        // willingness to provide higher than fee is based on:
        // * number of pending trades

        reward *= count;

        return reward;
    }

    function execInternal(uint16 id, address[] calldata addrs) override internal returns (uint256) {
        address token = authorizedTokens[id];

        uint total = 0;
        uint count = 0;

        address[] memory destAddrs = new address[](addrs.length);
        uint[] memory srcAmounts = new uint[](addrs.length);
        uint[] memory dstAmounts = new uint[](addrs.length);

        {
            uint transferFee = opInfo[id].fee;

            for(uint i = 0;i < addrs.length;i++) {
                (uint amount, address destAddr) = calculateApproveValueInternal(token, id, addrs[i]);

                if(amount > 0) {
                    count++;
                    total += amount;
                    srcAmounts[i] = amount;
                    dstAmounts[i] = amount - transferFee;
                    //destAddrs[i] = calculateDestinationAddress(t.allowance(addrs[i], address(this)));
                    destAddrs[i] = destAddr;
                }
            }

            if(count == 0)
                return 0; // cannot do anything

            // pull out fee
            uint remainingFee = transferFee * count;

            IERC20 t = IERC20(token);

            for(uint i = 0;i < addrs.length && remainingFee > 0;i++) {
                uint pulled = srcAmounts[i] >= remainingFee ? remainingFee : srcAmounts[i];

                t.transferFrom(addrs[i], address(this), pulled);
                srcAmounts[i] -= pulled;
                remainingFee -= pulled;
            }

            ITreasury(treasury).deposit(token, address(this), transferFee * count);
        }

        IERC20 t = IERC20(token);

        uint y = addrs.length - 1;
        for(uint x = 0;x < addrs.length;x++) {
            uint amt = srcAmounts[x];

            if(amt == 0)
                continue;

            for(;y != type(uint).max;y--) {
                uint dstAmount = dstAmounts[y];
                
                if(dstAmount == 0)
                    continue;

                if(amt >= dstAmount) {
                    console.log("sendpartial", y, dstAmount);
                    t.transferFrom(addrs[x], destAddrs[y], dstAmount);
                    amt = SafeMath.sub(amt, dstAmount);
                } else {
                    break;
                }
            }

            if(amt == 0)
                continue;

            console.log("sendremain", y, amt);
            t.transferFrom(addrs[x], destAddrs[y], amt);
            dstAmounts[y] = SafeMath.sub(dstAmounts[y], amt);
        }

        /*while(i != type(uint).max && curTo < addrs.length) {
            console.log("i is ", i);
            console.log("curTo is", curTo);

            if(dstRemaining < srcRemaining) {
                t.transferFrom(addrs[i], destAddrs[curTo], dstRemaining);

                srcRemaining -= dstRemaining;

                // skip over 0 transfer values
                do {
                    curTo++;
                } while(curTo < addrs.length - 1 && amounts[curTo] == 0);
                dstRemaining = amounts[curTo] - transferFee;
            }
            else {
                t.transferFrom(addrs[i], destAddrs[curTo], srcRemaining);
                
                dstRemaining -= srcRemaining;

                // skip over 0 transfer values
                do {
                    i--;
                } while(i > 0 && amounts[i] == 0);
                srcRemaining = amounts[i];
            }
        }

        // sanity
        console.log("srcRemaining", srcRemaining);
        console.log("dstRemaining", dstRemaining);
        require(srcRemaining == dstRemaining, "final transfer amount check");

        t.transferFrom(addrs[i], destAddrs[curTo], srcRemaining);*/

        return count;
    }
}