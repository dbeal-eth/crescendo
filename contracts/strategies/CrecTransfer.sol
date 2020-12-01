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
        address token = authorizedTokens[id];

        uint256 allowanceData = IERC20(token).allowance(payer, address(this));

        uint128 amt = uint128(allowanceData);
        uint32 deadline = uint16(allowanceData >> 192);

        if(amt <= opInfo[id].fee ||                                              // not enough transfer to cover fee + payload
            calculateOpId(allowanceData) != id ||                                // op id should match token
            calculateDestinationAddress(allowanceData) == address(0) ||          // destination address id is not registered
            deadline <= block.number) {                                          // block deadline has passed, transaction no longer valid
            return 0;
        }

        return amt;
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
        IERC20 t = IERC20(token);

        uint total = 0;
        uint count = 0;

        address[] memory destAddrs = new address[](addrs.length);
        uint[] memory amounts = new uint[](addrs.length);

        for(uint i = 0;i < addrs.length;i++) {
            uint amount = calculateApproveValue(token, id, addrs[i]);

            if(amount > 0) {
                count++;
                total += amount;
                amounts[i] = amount;
                destAddrs[i] = calculateDestinationAddress(t.allowance(addrs[i], address(this)));
            }
        }

        uint curTo = 0;
        while(amounts[curTo] == 0) {
            curTo++;
        }

        uint i = addrs.length - 1;
        while(amounts[i] == 0) {
            i--;
        }

        uint transferFee = opInfo[id].fee;
        uint dstRemaining = SafeMath.sub(amounts[curTo], transferFee);

        // pull out fee
        {
            uint fee = transferFee * count;
            t.transferFrom(addrs[curTo], address(this), fee);
            ITreasury(treasury).deposit(token, address(this), fee);
            amounts[curTo] -= fee;
        }

        uint srcRemaining = amounts[i];

        while(i >= 0 && curTo < addrs.length - 1) {
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
                } while(i >= 0 && amounts[i] == 0);
                srcRemaining = amounts[i];
            }
        }

        // sanity
        require(srcRemaining == dstRemaining, "final transfer amount check");

        t.transferFrom(addrs[i], destAddrs[curTo], srcRemaining);
    }
}