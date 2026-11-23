const path = require("path");
process.env.LOCALAPPDATA = path.join(__dirname, ".localappdata");
require("@nomicfoundation/hardhat-ethers");
require("dotenv").config({ path: "../.env" });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  mocha: {
    timeout: 1800000,
  },
  networks: {
    hardhat: {
      chainId: 31337,
      blockGasLimit: 1_000_000_000,
      forking: process.env.HARDHAT_FORK ? {
        url: process.env.HARDHAT_FORK,
        blockNumber: 76493945,
      } : undefined,
    },
    xlayer_fork: {
      url: process.env.FORK_RPC_URL || "http://127.0.0.1:8545",
    },
    xlayer: {
      url: process.env.XLAYER_RPC_URL || "https://rpc.xlayer.tech",
      chainId: 196,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
};
