const mysql = require("mysql");
const { Contract, providers, utils } = require("ethers");

const config = require("./config.json");
const AprFeedAbi = require("./abis/aprfeedAbi.json");
const MulticallAbi = require("./abis/multicallAbi.json");

const multicallAddr = "0xF7d11c74B5706155d7C6DBe931d590611a371a8a";
const aprfeedAddr = "0x49b071664908299de9afa9e81f560b5e884046e0";
const provider = new providers.JsonRpcProvider(
  "https://testnet.evm.nodes.onflow.org"
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
  "0x8C1CEc925beB7944941b612B70aE280C984FA633",
  "0x6dCbc5E23Aab3CBb702974D5cDb3837dc0b2e9D6",
  "0x5c53Fe805381e588Aa17dA5a0635edc4D4bab8DF",
  "0x60e72F2D276619115a11BFb3Cf89B2f28432887E",
  "0xAe631435Fc9096047Bc2698c705382F4DA94663B",
];

const marketIds = [
  "0x6bed9b33d3ee7142f53ba4cf930d61e4aff25a4677150cfe354e9b75a2ee2547",
  "0x75a964099ef99a0c7dc893c659a4dec8f6beeb3d7c9705e28df7d793694b6164",
  "0x0f0de7ddadc86a7be1a3d3e1a9d2e8090a791299bcf0985626ae4ebd65add87e",
  "0xa60293202460d7df68151ac06ec00f6b3dfb5ff119ca579107673bd843547875",
  "0x0f510c5cca1c8b24bbbccb04833d1243dcb4e6ae07e4f39397dbd9fa6534dece",
  "0x16893ff750ddec34e292a65a8cb6a014627b3f4ad0b2b82c6da4cc28d1e0576d",
  "0x19993995e633d686a7a7a4db10d363c2f6dddc744f3ec31e6f8f12d6344bc25d",
  "0x81721c60cf152bf1395d9c1cae5ab87453bba99636c4a3e3f985570e4a7bcb7c",
  "0xbb1c25a3dd81910d745b07e0926dc1cc7be6f09c2c5cc025c0d581e44c21c67f",
  "0x595199e0d78e7769da797d595abf4801bf0ed2bedd0e745a24bb4aebc0310e53",
  "0x65e3819781cfb3d6865688fe41757484af047fc1aeaca1752b0bf4cacaae555c",
  "0xaccc9ce078cc2228bc0a0328b0f207311a9dcdfd96d7e34ac829a38e8af953d1",
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
      body: err.message,
    };
  }
};

// main().finally(() => console.log("finally"));
