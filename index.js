const mysql = require("mysql");
const { Contract, providers, utils } = require("ethers");

const config = require("./config.json");
const AprFeedAbi = require("./abis/aprfeedAbi.json");
const MulticallAbi = require("./abis/multicallAbi.json");

const multicallAddr = "0x8358d18E99F44E39ea90339c4d6E8C36101f8161";
const aprfeedAddr = "0x9c2CE59eCC6930fFd12bE4944B482df008486D7f";

const provider = new providers.JsonRpcProvider(
  "https://mainnet.evm.nodes.onflow.org"
);
const multicallContrcat = new Contract(multicallAddr, MulticallAbi, provider);

const aprfeedInterface = new utils.Interface(AprFeedAbi);
const aprfeedAbicorder = new utils.AbiCoder();

const connection = mysql.createConnection({
  host: config.db_host,
  port: config.db_port,
  user: config.db_user,
  password: config.db_pawd,
  database: config.db_name,
});

const vaultIds = [
  "0xe2aaC46C1272EEAa49ec7e7B9e7d34B90aaDB966",
  "0x8c921f740B0065C7cE28EB93c7056d92C4735E7b",
];
const marketIds = [
  "0x3dca1854528f8a9bff744889198eb07ceacdfe25937450965e62103cefc69aa5",
  "0x2ae0c40dc06f58ff0243b44116cd48cc4bdab19e2474792fbf1f413600ceab3a",
];

exports.handler = async (event) => {
  // const main = async () => {
  try {
    const currentTimestamp = Math.floor(Date.now() / 1000).toString();

    // fetch vault rates first
    let readCallArr = [];
    for (const vaultId of vaultIds) {
      readCallArr.push({
        target: aprfeedAddr,
        callData: aprfeedInterface.encodeFunctionData("getVaultSupplyRate", [
          vaultId,
        ]),
      });
    }

    for (const marketId of marketIds) {
      readCallArr.push({
        target: aprfeedAddr,
        callData: aprfeedInterface.encodeFunctionData("getMarketSupplyRate", [
          marketId,
        ]),
      });

      readCallArr.push({
        target: aprfeedAddr,
        callData: aprfeedInterface.encodeFunctionData("getBorrowRate", [
          marketId,
        ]),
      });
    }

    const vaultSupplyAprs = await multicallContrcat.callStatic.aggregate(
      readCallArr
    );

    const aprList = vaultSupplyAprs[1];

    const data = await new Promise((resolve, reject) => {
      connection.connect(function (err) {
        if (err) {
          reject(err);
        }

        let vaultQuery = `INSERT INTO vault_aprs (vaultid, supply_apr, apr_time) VALUES `;
        for (let ii = 0; ii < vaultIds.length; ii++) {
          const supplyApr = utils.formatEther(aprList[ii]);
          vaultQuery += `('${vaultIds[ii]}', '${supplyApr}', '${currentTimestamp}')`;

          if (ii < vaultIds.length - 1) vaultQuery += `, `;
        }

        // console.log(vaultQuery);
        connection.query(vaultQuery, function (err, result) {
          if (err) {
            console.log("VaultAPR Error->" + err);
            reject(err);
          }

          resolve(result);
        });

        // update market info
        let marketQuery = `INSERT INTO market_aprs (marketid, supply_apr_usual, supply_apr_premium, borrow_apr, apr_time) VALUES `;
        for (let ii = 0; ii < marketIds.length; ii++) {
          const marketInd = ii * 2 + vaultIds.length;
          const marketSupplyAprs = aprfeedAbicorder.decode(
            ["uint256", "uint256"],
            aprList[marketInd]
          );

          const usualSupplyApr = utils.formatEther(marketSupplyAprs[0]);
          const premiumSupplyApr = utils.formatEther(marketSupplyAprs[1]);
          const borrowApr = utils.formatEther(aprList[marketInd + 1]);

          marketQuery += `('${marketIds[ii]}', '${usualSupplyApr}', '${premiumSupplyApr}', '${borrowApr}', '${currentTimestamp}')`;
          if (ii < marketIds.length - 1) marketQuery += `, `;
        }

        // console.log(marketQuery);
        connection.query(marketQuery, function (err, result) {
          if (err) {
            console.log("MarketAPR Error->" + err);
            reject(err);
          }

          resolve(result);
        });
      });
    });

    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 400,
      body: error.message,
    };
  }
};

// main().finally(() => console.log("finally"));
