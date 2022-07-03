require("@nomiclabs/hardhat-waffle");
require('@nomiclabs/hardhat-ethers');
require("@nomiclabs/hardhat-etherscan");
require('hardhat-deploy');


module.exports = {
  namedAccounts: {
    deployer: {
      default: 0
    }
  },
  defaultNetwork: "hardhat",
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: ""
  },
  hardhat: {},
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      gasPrice: 5000000000,
    },
    hardhat: {
      chainId: 1111,
      accounts: {
        count: 50
      }
    },
    testnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545/",
      chainId: 97,
      accounts: [''],
      timeout: 100000
    },
    mainnet: {
      url: "https://bsc-dataseed1.defibit.io/",
      chainId: 56,
      gasPrice: 6000000000,
      accounts: [''],
      timeout: 1000000
    }
  },
  solidity: {
    version: "0.8.6",
    settings: {
      optimizer: {
        enabled: true,
        runs: 10000
      }
    }
  },
};
