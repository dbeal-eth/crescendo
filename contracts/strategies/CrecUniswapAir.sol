//SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

import "hardhat/console.sol";

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";
import "lbp/interfaces/IERC20.sol";

import "../Crescendo.sol";

import "../interfaces/ITreasury.sol";

struct Pair {
    address uniswapPair;
    address src;
    address dst;
}

struct TokenAmounts {
    uint256 totalIn0;
    uint256 totalIn1;

    uint256 cover0;
    uint256 cover1;

    uint256 totalOut0;
    uint256 totalOut1;

    uint256 feeToPay;

    uint256 validAddrs;
}

contract CrecUniswapAir is Crescendo {

    // minimum trade relative to the size of the fee, not including the fee
    uint256 constant MIN_TRADE_FACTOR = 3;

    // max slippage percent impact  where 1% = 1e18
    uint256 constant MAX_SLIPPAGE_IMPACT = 1e18;

    // next ID to use on addAuthorizedPair
    uint16 nextId;

    // uniswap pairs which may be exchanged by this contract
    mapping(uint16 => Pair) public authorizedPairs;

    event NewAuthorizedPair(uint16 id, address src, address dst, address uniswapPair);

    constructor(address _treasury, uint32 _targetInterval, uint128 _targetTreasuryBalance) public {
        treasury = _treasury;
        targetInterval = _targetInterval;
        targetTreasuryBalance = _targetTreasuryBalance;
        
        nextId = 1;
    }

    function addAuthorizedPair(address pair, uint startFee) external onlyOwner {
        IUniswapV2Pair uniPair = IUniswapV2Pair(pair);

        address token0 = uniPair.token0();
        address token1 = uniPair.token1();

        Pair memory p0;
        p0.src = token0;
        p0.dst = token1;
        p0.uniswapPair = pair;

        authorizedPairs[nextId] = p0;
        opInfo[nextId] = OpInfo(uint128(startFee), uint128(block.timestamp));
        nextId = nextId + 1;

        // infinite approve treasury to pull this token for fees
        IERC20(token0).approve(treasury, type(uint256).max);
        IERC20(token1).approve(treasury, type(uint256).max);

        emit NewAuthorizedPair(nextId - 1, p0.src, p0.dst, p0.uniswapPair);
    }

    function getReward(uint16 pair, uint count) public view override returns (uint256) {
        return getRewardInternal(pair, count);
    }

    function getRewardInternal(uint16 pair, uint count) internal view returns (uint256) {

        OpInfo memory info = opInfo[pair];

        uint curtime = block.timestamp;

        console.log("CURTIME", curtime);
        console.log("LASTTIME", info.lastTime);

        console.log("TIME DIFF", curtime - info.lastTime);

        // calculate the base reward for a single address
        // reward should be = to opFee WHEN target process time is equal to now
        // reward should be = to 0 WHEN target process time is less than now
        uint reward = SafeMath.div(SafeMath.mul(curtime - info.lastTime, info.fee), targetInterval);

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

    function calculateTradeValue(address addr, uint16 pair, address payer) internal returns (uint256) {
        Pair memory p = authorizedPairs[pair];

        uint256 allowanceData = IERC20(addr).allowance(payer, address(this));

        uint80 minTradeAmount = uint80(allowanceData >> 176);
        uint16 pairId = uint16(allowanceData >> 160);
        uint32 deadline = uint32(allowanceData >> 128);

        uint128 amt = uint128(allowanceData);

        if(pairId != pair || deadline < block.number)
            return 0;

        return amt;
    }

    function getUniswapRate(uint amountIn, uint reserveIn, uint reserveOut) internal pure returns (uint amountOut) {
        return SafeMath.mul(amountIn, reserveOut) / reserveIn;
    }

    // from uniswap lib
    // given an output amount of an asset and pair reserves, returns a required input amount of the other asset
    function getUniswapAmountIn(uint amountOut, uint reserveIn, uint reserveOut) internal pure returns (uint amountIn) {
        uint numerator = SafeMath.mul(SafeMath.mul(reserveIn, amountOut), 1000);
        uint denominator = SafeMath.mul(SafeMath.sub(reserveOut, amountOut), 997);
        amountIn = SafeMath.add(numerator / denominator, 1);
    }

    // from uniswap lib
    // given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
    function getUniswapAmountOut(uint amountIn, uint reserveIn, uint reserveOut) internal pure returns (uint amountOut) {
        uint amountInWithFee = SafeMath.mul(amountIn, 997);
        uint numerator = SafeMath.mul(amountInWithFee, reserveOut);
        uint denominator = SafeMath.add(SafeMath.mul(reserveIn, 1000), amountInWithFee);
        amountOut = numerator / denominator;
    }


    function execInternal(uint16 pair, address[] calldata addrs) override internal returns (uint256) {

        TokenAmounts memory amts;

        if(addrs.length > 0) {
            Pair memory p = authorizedPairs[pair];
            address token0 = p.src;
            address token1 = p.dst;

            // pull funds from each address
            uint[] memory inAmounts0 = new uint[](addrs.length);
            uint[] memory inAmounts1 = new uint[](addrs.length);

            {
                uint fee = opInfo[pair].fee;
                amts.validAddrs = addrs.length;
                amts.feeToPay = fee * amts.validAddrs;

                for(uint i = 0;i < addrs.length;i++) {
                    inAmounts0[i] = calculateTradeValue(token0, pair, addrs[i]);
                    if(inAmounts0[i] > 0) {
                        console.log("deduct from 0 ", inAmounts0[i]);
                        amts.totalIn0 += inAmounts0[i];
                        IERC20(token0).transferFrom(addrs[i], address(this), inAmounts0[i]);
                        continue;
                    }

                    inAmounts1[i] = inAmounts0[i] > 0 ? 0 : calculateTradeValue(token1, pair, addrs[i]);

                    if(inAmounts1[i] > 0) {
                        console.log("deduct from 1 ", inAmounts1[i]);
                        amts.totalIn1 += inAmounts1[i];
                        IERC20(token1).transferFrom(addrs[i], address(this), inAmounts1[i]);
                        continue;
                    }

                    // this address will not be trading
                    console.log("skip trade");
                    amts.feeToPay -= fee;
                }
            }

            // run uniswap trade
            if (amts.totalIn0 > 0 || amts.totalIn1 > 0) {
                IUniswapV2Pair uniPair = IUniswapV2Pair(p.uniswapPair);

                (uint reserve0, uint reserve1, uint _unused) = uniPair.getReserves();

                // calculate ideal rate if we were to just trade without slippage
                amts.cover1 = getUniswapRate(amts.totalIn0, reserve0, reserve1);
                amts.cover0 = getUniswapRate(amts.totalIn1, reserve1, reserve0);

                // swap only the required amount
                if(amts.totalIn0 > amts.cover0 && amts.totalIn0 - amts.cover0 > amts.feeToPay) {
                    ITreasury(treasury).deposit(token0, address(this), amts.feeToPay);
                    
                    uint traded = amts.totalIn0 - amts.cover0 - amts.feeToPay + amts.feeToPay * amts.totalIn1 * reserve0 / (amts.totalIn0 * reserve1);

                    IERC20(token0).transfer(p.uniswapPair, traded);
                    uniPair.swap(0, getUniswapAmountOut(traded, reserve0, reserve1), address(this), "0x");

                    amts.cover0 = amts.totalIn0 - traded - amts.feeToPay;
                    amts.cover1 = amts.totalIn1 + getUniswapAmountOut(traded, reserve0, reserve1);

                } else if(amts.totalIn1 > amts.cover1 && amts.totalIn1 - amts.cover1 > amts.feeToPay) {
                    // use uniswap to convert the fee paid
                    ITreasury(treasury).deposit(token1, address(this), getUniswapRate(amts.feeToPay, reserve0, reserve1));

                    uint traded = amts.totalIn1 - amts.cover1 - amts.feeToPay + amts.feeToPay * amts.totalIn0 * reserve1 / (amts.totalIn1 * reserve0);

                    IERC20(token1).transfer(p.uniswapPair, traded);
                    uniPair.swap(getUniswapAmountOut(traded, reserve1, reserve0), 0, address(this), "0x");

                    amts.cover0 = amts.totalIn0 + getUniswapAmountOut(traded, reserve1, reserve0);
                    amts.cover1 = amts.totalIn1 - traded - amts.feeToPay;
                }
                else {

                }
            }

            console.log("cover 0", amts.cover0);
            console.log("cover 1", amts.cover1);

            // return money
            for(uint i = 0;i < addrs.length;i++) {
                if(inAmounts0[i] > 0) {
                    uint val = SafeMath.div(SafeMath.mul(amts.cover1, inAmounts0[i]), amts.totalIn0);

                    if(amts.cover1 - amts.totalOut1 < amts.feeToPay / addrs.length + val) {
                        console.log("this is last");
                        val = amts.cover1 - amts.totalOut1;
                    }

                    console.log("distribute with 1", val);

                    amts.totalOut1 += val;
                    IERC20(token1).transfer(addrs[i], val);
                }
                else if(inAmounts1[i] > 0) {
                    uint val = SafeMath.div(SafeMath.mul(amts.cover0, inAmounts1[i]), amts.totalIn1);

                    if(amts.cover0 - amts.totalOut0 < amts.feeToPay / addrs.length + val) {
                        console.log("this last");
                        val = amts.cover0 - amts.totalOut0;
                    }

                    console.log("distribute with 0", val);

                    amts.totalOut0 += val;
                    IERC20(token0).transfer(addrs[i], val);
                }
            }
        }

        return amts.validAddrs;
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