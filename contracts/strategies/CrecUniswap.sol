//SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

import "hardhat/console.sol";

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/ITreasury.sol";

struct Pair {
    address uniswapPair;
    address src;
    address dst;
}

contract CrecUniswap is Ownable {

    // minimum trade relative to the size of the fee, not including the fee
    uint256 constant MIN_TRADE_FACTOR = 3;

    // must set this so we know that we have data fields
    uint256 constant MIN_TRADE_SIZE = 20;

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

    // next ID to use on addAuthorizedPair
    uint16 nextId;

    address public treasury;

    // when was the luint8(ast batch operation completed for this pair
    mapping(uint16 => uint256) public markedTime;
    mapping(uint16 => address) public markedAddress;

    mapping(uint16 => uint128) public pairFee;

    // uniswap pairs which may be exchanged by this contract
    mapping(uint16 => Pair) public authorizedPairs;

    event NewAuthorizedPair(uint16 id, address src, address dst, address uniswapPair);

    constructor(address _treasury, uint32 _targetInterval, int128 _targetTreasuryBalance) public {
        treasury = _treasury;
        targetInterval = _targetInterval;
        targetTreasuryBalance = _targetTreasuryBalance;
        laggingTreasuryBalance = targetTreasuryBalance;

        // try to target cost of an uniswap transaction given current gas prices
        lastFeeAmount = 100000 * uint128(tx.gasprice);
        
        nextId = 1;
    }

    function getReward(uint16 pair, uint count) internal view returns (uint256) {

        uint execTime = markedTime[pair];
        require(execTime > 0, "not marked");

        uint curtime = block.timestamp;

        // calculate the base reward for a single address
        // reward should be = to pairFee WHEN target process time is equal to now
        // reward should be = to 0 WHEN target process time is less than now
        uint reward = SafeMath.div(SafeMath.mul(curtime - markedTime[pair], pairFee[pair]), targetInterval);

        // willingness to provide higher than fee is based on:
        // * number of pending trades

        uint addressAddReward = reward / 2;

        for(uint256 i = 1;i < count;i++) {
            reward = SafeMath.add(reward, addressAddReward);
            addressAddReward /= 2;
        }

        // * amount of money in the treasury vs. target

        //reward = reward * treasury.getTreasuryBalance() / targetTreasuryBalance;

        return reward;
    }

    function calculateTradeValue(uint16 pair, address payer) internal returns (uint256) {
        Pair memory p = authorizedPairs[pair];

        uint256 allowanceData = IERC20(p.src).allowance(payer, address(this));

        require(allowanceData >= MIN_TRADE_SIZE, "ineligable allowance");
        require(uint16(allowanceData) == pair, "pair id mismatch");

        uint256 spendAmount = allowanceData >> 8 == 1 ? allowanceData : (allowanceData >> 16) << 16;

        return spendAmount;
    }

    function addAuthorizedPair(address pair) external onlyOwner {
        IUniswapV2Pair uniPair = IUniswapV2Pair(pair);

        address token0 = uniPair.token0();
        address token1 = uniPair.token1();

        Pair memory p0;
        Pair memory p1;
        p0.src = token0;
        p1.src = token1;
        p0.dst = token1;
        p1.dst = token0;
        p0.uniswapPair = pair;
        p1.uniswapPair = pair;

        authorizedPairs[nextId] = p0;
        authorizedPairs[nextId + 1] = p1;

        pairFee[nextId] = lastFeeAmount;
        pairFee[nextId + 1] = lastFeeAmount;

        nextId = nextId + 2;

        // infinite approve treasury to pull this token for fees
        IERC20(token0).approve(treasury, type(uint256).max);
        IERC20(token1).approve(treasury, type(uint256).max);

        emit NewAuthorizedPair(nextId - 2, p0.src, p0.dst, p0.uniswapPair);
        emit NewAuthorizedPair(nextId - 1, p1.src, p1.dst, p1.uniswapPair);
    }

    function updateFee(uint16 pair) internal {

        int256 currentTreasuryBalance = int256(ITreasury(treasury).getTreasuryBalance());

        int256 deltaTreasuryBalance = int256(currentTreasuryBalance) - laggingTreasuryBalance;
        int256 deltaTime = int256(block.timestamp) - int256(lastFeeChangeDate);

        int256 balanceRatio = (currentTreasuryBalance * 1e7 / targetTreasuryBalance);
        int256 balanceSlope = (deltaTreasuryBalance * 1e7 / targetTreasuryBalance / deltaTime);

        int256 prediction = 1e7 - balanceRatio + TREASURY_TARGET_PERIOD * balanceSlope;

        uint128 newFee = uint128(lastFeeAmount + prediction);

        pairFee[pair] = newFee;
        lastFeeAmount = newFee;
        lastFeeChangeDate = uint128(block.timestamp);

        laggingTreasuryBalance = int128(laggingTreasuryBalance + (currentTreasuryBalance - laggingTreasuryBalance) / 10);
    }

    /**
     * starts the timer for payouts for miners. The miner must provide a "payer" which has authorized some amount for this contract to spend
     * TODO: prevent mark after mark already has occured
     */
    function mark(uint16 pair, address payer) external {

        uint spendAmount = calculateTradeValue(pair, payer);

        require(IERC20(authorizedPairs[pair].src).balanceOf(payer) > spendAmount, "insufficient balance");

        markedTime[pair] = block.timestamp;
        markedAddress[pair] = payer;
    }

    // from unisawp lib
    // given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
    function getUniswapAmountOut(uint amountIn, uint reserveIn, uint reserveOut) internal pure returns (uint amountOut) {
        uint amountInWithFee = SafeMath.mul(amountIn, 997);
        uint numerator = SafeMath.mul(amountInWithFee, reserveOut);
        uint denominator = SafeMath.add(SafeMath.mul(reserveIn, 1000), amountInWithFee);
        amountOut = numerator / denominator;
    }

    function exec(uint16 pair, address[] calldata addrs) external {
        //require(!isTrustedForwarder(msg.sender));

        Pair memory p = authorizedPairs[pair];
        IERC20 src = IERC20(p.src);
        IERC20 dst = IERC20(p.dst);

        require(markedTime[pair] != 0, "not marked");
        require(markedAddress[pair] == addrs[0], "first address and marked address do not match");

        // pull funds from each address
        uint totalIn = 0;
        uint[] memory inAmounts = new uint[](addrs.length);

        uint fee = pairFee[pair] * addrs.length;

        for(uint i = 0;i < addrs.length;i++) {
            uint inAmount = calculateTradeValue(pair, addrs[i]);
            totalIn += inAmount;

            // gas savings: pay the fee directly to the treasury in this loop
            if(fee > 0 && inAmount > fee) {
                // deposit fee to treasury
                src.transferFrom(addrs[i], address(this), fee);
                ITreasury(treasury).deposit(p.src, address(this), fee);

                src.transferFrom(addrs[i], p.uniswapPair, inAmount - fee);

                fee = 0;
            }
            else {
                src.transferFrom(addrs[i], p.uniswapPair, inAmount);
            }

            inAmounts[i] = inAmount;
        }

        uint amountOut;

        {
            // run uniswap trade
            IUniswapV2Pair uniPair = IUniswapV2Pair(p.uniswapPair);

            (uint reserve0, uint reserve1, uint _unused) = uniPair.getReserves();

            if(uniPair.token0() == p.src) {
                amountOut = getUniswapAmountOut(totalIn - fee, reserve0, reserve1);
                uniPair.swap(0, amountOut, address(this), "0x");
            } else {
                amountOut = getUniswapAmountOut(totalIn - fee, reserve1, reserve0);
                uniPair.swap(amountOut, 0, address(this), "0x");
            }
        }

        // return money
        uint totalOut = 0;
        for(uint i = 0;i < addrs.length - 1;i++) {
            uint val = SafeMath.div(SafeMath.mul(amountOut, inAmounts[i]), totalIn);
            totalOut += val;
            dst.transfer(addrs[i], val);
        }

        // congrats last person, you get the dust
        dst.transfer(addrs[addrs.length - 1], amountOut - totalOut);

        // send reward
        ITreasury(treasury).withdraw(ITreasury(treasury).getTreasuryToken(), msg.sender, getReward(pair, addrs.length));

        // update fee
        updateFee(pair);

        markedTime[pair] = 0;
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