Crescendo Optimizing Proxy
====

Crescendo is a gas optimizing proxy for popular defi protocols, such as Uniswap or stablecoins like Tether.

# Spin up Local Development

To test crescendo in a local testnet, follow the following instructions:

1. Install npm dependencies: `npm install` 

# `npm--save-dev hardhat ts-node typescript @types/node @types/mocha ethers @nomiclabs/hardhat-waffle ethereum-waffle hardhat-typechain typechain ts-generator @typechain/ethers-v5 @nomiclabs/hardhat-ethers chai @nomiclabs/hardhat-etherscan`
2. Compile typechain definitions: `npx hardhat typechain`
3. (optional) run the tests: `npx hardhat test`
4. Start up the local testnet:
    * Start hardhat test network: `npx hardhat node`
    * Start opengsn relay and contracts: `npx gsn start`
    * Deploy crescendo ecosystem and contracts: `./deploy-local-env.sh`
    * Start web UI: `npx webpack && npx http-server build/`
5. Open your browser to http://localhost:8080