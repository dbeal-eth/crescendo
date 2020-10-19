const {task, usePlugin} = require('@nomiclabs/buidler/config');

usePlugin("@nomiclabs/buidler-ethers");
usePlugin("@nomiclabs/buidler-waffle");
usePlugin("buidler-typechain");

// This is a sample Buidler task. To learn how to create your own go to
// https://buidler.dev/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, bre) => {
  const accounts = await bre.ethers.getSigners();

  for (const account of accounts) {
    console.log(await account.getAddress());
  }
});

task('html', 'Build the web UI', async (taskArgs, bre) => {

});

// Go to https://buidler.dev/config/ to learn more
module.exports = {
  defaultNetwork: 'buidlerevm',

  networks: {
    buidlerevm: {
      blockGasLimit: 100000000,
      allowUnlimitedContractSize: true
    },
    local: {
      url: `http://localhost:8545`
    },
    kovan: {
      url: `https://poa-kovan.gateway.pokt.network/v1/${process.env.POKT}`,
      accounts: [process.env.KEY || '']
    },
    mainnet: {
      url: `https://eth-mainnet.gateway.pokt.network/v1/${process.env.POKT}`,
      accounts: [process.env.KEY || '']
    }
  },
  solc: {
    version: "0.6.12",
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },

  typechain: {
    target: "ethers-v5",
  },
};
