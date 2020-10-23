Crescendo Optimizing Proxy
====

Crescendo is a gas optimizing proxy for popular defi protocols, such as Uniswap or stablecoins like Tether.

# Spin up Local Development

To test crescendo in a local testnet, follow the following instructions:

1. Install npm dependencies: `npm install`
2. Compile typechain definitions: `npx buidler typechain`
3. (optional) run the tests: `npx buidler test`
4. Start up the local testnet:
    * Start buidler test network: `npx buidler node`
    * Start opengsn relay and contracts: `npx gsn start`
    * Deploy crescendo ecosystem and contracts: `./deploy-local-env.sh`
    * Start web UI: `npx webpack && npx http-server build/`
5. Open your browser to http://localhost:8080