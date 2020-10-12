import { task, usePlugin } from "@nomiclabs/buidler/config";

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

// Go to https://buidler.dev/config/ to learn more
module.exports = {
  networks: {
    buidlerevm: {
      blockGasLimit: 100000000,
      allowUnlimitedContractSize: true
    },
  },
  solc: {
    version: "0.6.12",
  },

  typechain: {
    target: "ethers-v5",
  },
};
