#!/bin/bash

set -x -e

# get some tokens on uniswap

export ROUTER=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D

# token 1 = dai 0x6b175474e89094c44da98b954eedeac495271d0f
UNI_PATH=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2,0x6b175474e89094c44da98b954eedeac495271d0f AMOUNT=1000 npx hardhat --network local run --no-compile scripts/code/trade-uniswap.ts 

# token 2 = usdc 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
UNI_PATH=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2,0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 AMOUNT=1000 npx hardhat --network local run --no-compile scripts/code/trade-uniswap.ts 

# token 3 = wbtc 0x2260fac5e5542a773aa44fbcfedf7c193bc2c599
UNI_PATH=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2,0x2260fac5e5542a773aa44fbcfedf7c193bc2c599 AMOUNT=1 npx hardhat --network local run --no-compile scripts/code/trade-uniswap.ts


# deploy crescendo
export TREASURY=$(BFACTORY=0x9424B1412450D0f8Fc2255FAf6046b98213B76Bd TOKENS=0x6b175474e89094c44da98b954eedeac495271d0f=100,0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48=100,0x2260fac5e5542a773aa44fbcfedf7c193bc2c599=0.1 npx hardhat --network local run --no-compile scripts/code/deploy-treasury.ts)

echo "treasury deployed at $TREASURY"
TOKENS=0x6b175474e89094c44da98b954eedeac495271d0f,0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48,0x2260fac5e5542a773aa44fbcfedf7c193bc2c599 npx hardhat --network local run --no-compile scripts/code/deploy-crec-transfer.ts