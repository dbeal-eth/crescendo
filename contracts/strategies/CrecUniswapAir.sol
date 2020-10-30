//SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

import "@nomiclabs/buidler/console.sol";

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/ITreasuryManager.sol";
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

contract CrecUniswapAir is ITreasuryManager, Ownable {

    // minimum trade relative to the size of the fee, not including the fee
    uint256 constant MIN_TRADE_FACTOR = 3;

    // max slippage percent impact  where 1% = 1e18
    uint256 constant MAX_SLIPPAGE_IMPACT = 1e18;

    uint256 constant TREASURY_TARGET_PERIOD = 7 * 24 * 60 * 60; // 1 week

    // amount of money that should be in the treasury
    uint128 public targetTreasuryBalance;

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

    constructor(address _treasury, uint32 _targetInterval, uint128 _targetTreasuryBalance) public {
        treasury = _treasury;
        targetInterval = _targetInterval;
        targetTreasuryBalance = _targetTreasuryBalance;

        // try to target cost of an uniswap transaction given current gas prices
        lastFeeAmount = 100000 * uint128(tx.gasprice);
        
        nextId = 1;
    }

    function getMaxSpend(bytes memory data) public override returns (uint256) {
        // parse calldata args
        uint16 pair = uint16At(data, 0);
        uint256 count = uint256At(data, 0x4);

        return getReward(pair, count);
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

    function calculateTradeValue(address addr, uint16 pair, address payer) internal returns (uint256) {
        Pair memory p = authorizedPairs[pair];

        uint256 allowanceData = IERC20(addr).allowance(payer, address(this));

        uint80 minTradeAmount = uint80(allowanceData >> 176);
        uint16 pairId = uint16(allowanceData >> 160);
        uint32 deadline = uint32(allowanceData >> 128);

        uint128 amt = uint128(allowanceData);

        if(pairId == pair ||
            deadline > block.number)
            return 0;

        return amt;
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

        uint currentTreasuryBalance = ITreasury(treasury).getTreasuryBalance();

        uint128 newFee = uint128(SafeMath.mul(pairFee[pair], uint256(targetTreasuryBalance)) / currentTreasuryBalance);

        pairFee[pair] = newFee;
        lastFeeAmount = newFee;
        lastFeeChangeDate = uint128(block.timestamp);
    }

    /**
     * starts the timer for payouts for miners. The miner must provide a "payer" which has authorized some amount for this contract to spend
     * TODO: prevent mark after mark already has occured
     */
    function mark(uint16 pair, address payer) external {

        Pair memory p = authorizedPairs[pair];
        address token0 = p.src;
        address token1 = p.dst;

        uint spendAmount0 = calculateTradeValue(token0, pair, payer);
        uint spendAmount1 = calculateTradeValue(token0, pair, payer);

        require(spendAmount0 > 0 || spendAmount1 > 0);
        require(spendAmount0 == 0 || IERC20(token0).balanceOf(payer) > spendAmount0, "insufficient balance");
        require(spendAmount1 == 0 || IERC20(token1).balanceOf(payer) > spendAmount1, "insufficient balance");


        markedTime[pair] = block.timestamp;
        markedAddress[pair] = payer;
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


    function exec(uint16 pair, address[] calldata addrs) external {
        require(markedTime[pair] != 0, "not marked");
        require(markedAddress[pair] == addrs[0], "first address and marked address do not match");

        Pair memory p = authorizedPairs[pair];
        address token0 = p.src;
        address token1 = p.dst;

        TokenAmounts memory amts;

        // pull funds from each address
        uint[] memory inAmounts0 = new uint[](addrs.length);
        uint[] memory inAmounts1 = new uint[](addrs.length);

        {
            uint fee = pairFee[pair];
            amts.validAddrs = addrs.length;
            amts.feeToPay = fee * amts.validAddrs;

            for(uint i = 0;i < addrs.length;i++) {
                inAmounts0[i] = calculateTradeValue(token0, pair, addrs[i]);
                if(inAmounts0[i] > 0) {
                    amts.totalIn0 += inAmounts0[i];
                    IERC20(token0).transferFrom(addrs[i], address(this), inAmounts0[i]);
                    continue;
                }

                inAmounts1[i] = inAmounts0[i] > 0 ? 0 : calculateTradeValue(token1, pair, addrs[i]);

                if(inAmounts1[i] > 0) {
                    amts.totalIn1 += inAmounts1[i];
                    IERC20(token1).transferFrom(addrs[i], address(this), inAmounts1[i]);
                    continue;
                }

                // this address will not be trading
                amts.feeToPay -= fee;
            }
        }

        // run uniswap trade
        {
            IUniswapV2Pair uniPair = IUniswapV2Pair(p.uniswapPair);

            (uint reserve0, uint reserve1, uint _unused) = uniPair.getReserves();

            // calculate ideal rate if we were to just trade without slippage
            amts.cover1 = getUniswapRate(amts.totalIn0, reserve0, reserve1);
            amts.cover0 = getUniswapRate(amts.totalIn1, reserve1, reserve0);

            // swap only the required amount
            if(amts.totalIn0 > amts.cover0 && amts.totalIn0 - amts.cover0 > amts.feeToPay) {
                ITreasury(treasury).deposit(token0, address(this), amts.feeToPay);
                
                uint traded = amts.totalIn0 - amts.cover0 - amts.feeToPay + amts.feeToPay * amts.totalIn1 * reserve0 / (amts.totalIn0 * reserve1);

                console.log(amts.feeToPay);
                console.log(traded);

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

        // return money
        for(uint i = 0;i < addrs.length - 1;i++) {
            if(inAmounts0[i] > 0) {
                uint val = SafeMath.div(SafeMath.mul(amts.cover1, inAmounts0[i]), amts.totalIn0);

                if(amts.cover1 - amts.totalOut1 < amts.feeToPay / addrs.length + val)
                    IERC20(token1).transfer(addrs[i], amts.cover1 - amts.totalOut1);
                else {
                    amts.totalOut1 += val;
                    IERC20(token1).transfer(addrs[i], val);
                }
            }
            else if(inAmounts1[i] > 0) {
                uint val = SafeMath.div(SafeMath.mul(amts.cover0, inAmounts1[i]), amts.totalIn1);

                if(amts.cover0 - amts.totalOut0 < amts.feeToPay / addrs.length + val)
                    IERC20(token0).transfer(addrs[i], amts.cover0 - amts.totalOut0);
                else {
                    amts.totalOut0 += val;
                    IERC20(token0).transfer(addrs[i], val);
                }
            }
        }

        // send reward
        ITreasury(treasury).withdraw(ITreasury(treasury).getTreasuryToken(), msg.sender, getReward(pair, amts.validAddrs));

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