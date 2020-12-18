const { task } = require('hardhat/config');

import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import 'hardhat-typechain';
import { HardhatUserConfig } from 'hardhat/types';
//const walletUtils = require("./walletUtils");

task("accounts", "Prints the list of accounts", async (taskArgs, bre) => {
  const accounts = await bre.ethers.getSigners();

  for (const account of accounts) {
    console.log(await account.getAddress());
  }
});

const hhConfig: HardhatUserConfig = {
  defaultNetwork: 'hardhat',

  networks: {
    hardhat: {
      blockGasLimit: 100000000,
      allowUnlimitedContractSize: true,
      accounts: {
        count: 200
      }
    },
    local: {
    url: `http://localhost:8545`,
    blockGasLimit: 100000000,
    allowUnlimitedContractSize: true
    },
    kovan: {
      url: `https://kovan.infura.io/v3/${process.env.INFURA}`,
      accounts: [process.env.KEY || '0x00']
    },
    /*
     kovan: {
      url: `https://kovan.infura.io/v3/d126f392798444609246423b06116c77`,
      accounts: walletUtils.makeKeyList(),
      chainId:42
    },
    */
    mainnet: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA}`,
      accounts: [process.env.KEY || '0x00']
    }
  },
  solidity: {

    compilers: [
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        }
      },
      /*{
        version: "0.5.16"
      }*/
    ],
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    }
  },

  typechain: {
    target: "ethers-v5",
  },
};

/*if(process.env.INFURA) {
  hhConfig.networks.hardhat.forking = {
    url: `https://mainnet.infura.io/v3/${process.env.INFURA}`,
  };
}*/

module.exports = hhConfig;
