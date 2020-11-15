import React, { useState, useEffect } from 'react';
import { BigNumber, ethers } from 'ethers';

import type { CrecUniswapAir as CrecUniswapContract } from '../../typechain/CrecUniswapAir';
import type { IUniswapV2Pair } from '../../typechain/IUniswapV2Pair';
import type { Ierc20 } from '../../typechain/Ierc20';
import { FiatTokenV2 } from '../../typechain/FiatTokenV2';

import InitWallet from './InitWallet';

//@ts-ignore
import CREC_UNISWAP_DATA = require('../../artifacts/contracts/Crescendo.sol/Crescendo.json');
//@ts-ignore
import FIATTOKENV2_DATA = require('../../artifacts/centre-tokens/contracts/v2/FiatTokenV2.sol/FiatTokenV2.json');
//@ts-ignore
import UNISWAP_PAIR_DATA = require('../../artifacts/@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol/IUniswapV2Pair.json');
import { getAddresses } from '../networks';


const UNISWAP_FEE = 0.003;

interface TokenInfo {
  name: string,
  symbol: string,
  addr: string
}

interface CrecUniswapContractInfo {
  // src, dest, uniswap pair address
  authorizedPairs: [TokenInfo, TokenInfo, string][],
  targetPeriod: number;
}

interface PairInfo {
  crecFee: number;
  uniswapRate: number;
}

function createCrecendoApproval(amt: string, id: number, deadline: number, minTradeAmount = '0') {
  return ethers.utils.parseEther(amt)
    .add(ethers.BigNumber.from(deadline).shl(128))
    .add(ethers.BigNumber.from(id).shl(160))
    .add(ethers.utils.parseEther(minTradeAmount).shl(176));
}

async function resolveTokenInfo(provider: ethers.providers.Provider, addr: string) {
  const t = new ethers.Contract(addr, FIATTOKENV2_DATA.abi, provider) as unknown as FiatTokenV2;

  try {
    const name = await t.name();
    const symbol = await t.symbol();

    return {
      name,
      symbol,
      addr: addr
    };
  } catch(err) {
    return {
      name: 'Unknown',
      symbol: 'UNK',
      addr: addr
    };
  }
}

function CrecUniswap() {
  const [provider, setProvider] = useState<ethers.providers.Web3Provider | null>(null);

  const [contractInfo, setContractInfo] = useState<CrecUniswapContractInfo|null>(null);
  const [pairInfo, setPairInfo] = useState<PairInfo|null>(null);

  const [selectedPair, setSelectedPair] = useState<number|null>(null);
  const [inAmount, setInAmount] = useState(0);

  const [submittedTxn, setSubmittedTxn] = useState<string|null>(null);

  // contract loading
  useEffect(() => {

    (async () => {

      if(!provider)
        return;

      const crecUniswap = new ethers.Contract(getAddresses(await provider.getNetwork()).crecUniswap, CREC_UNISWAP_DATA.abi, provider) as unknown as CrecUniswapContract;

      const pairs = await crecUniswap.queryFilter(crecUniswap.filters.NewAuthorizedOp(null, null, null, null));

      const newContractInfo: CrecUniswapContractInfo = {
        targetPeriod: await crecUniswap.targetInterval(),
        authorizedPairs: []
      };

      // resolve tokens
      const tokens: {[addr: string]: TokenInfo} = {};
      for(const pair of pairs) {
        if(!pair.args || !pair.args[1] || !pair.args[2])
          continue;

        if(!tokens[pair.args[1]]) {
          tokens[pair.args[1]] = await resolveTokenInfo(provider, pair.args[1]);
        }

        if(!tokens[pair.args[2]]) {
          tokens[pair.args[2]] = await resolveTokenInfo(provider, pair.args[2]);
        }

        newContractInfo.authorizedPairs[pair.args[0]] = [tokens[pair.args[1]], tokens[pair.args[2]], pair.args[3]];
      }

      console.log(newContractInfo);

      setContractInfo(newContractInfo);
    })();

  }, [provider]);

  // pair info 
  useEffect(() => {
    (async () => {

      if(!provider)
        return;

      if(!contractInfo || !selectedPair) {
        setPairInfo(null);
        return;
      }

      const crecUniswap = new ethers.Contract(getAddresses(await provider.getNetwork()).crecUniswap, CREC_UNISWAP_DATA.abi, provider) as unknown as CrecUniswapContract;

      const crecFee = ethers.utils.formatEther((await crecUniswap.opInfo(selectedPair)).fee);
  
      // get trading rate
      const uniswapPair = new ethers.Contract(contractInfo.authorizedPairs[selectedPair][2], UNISWAP_PAIR_DATA.abi, provider) as unknown as IUniswapV2Pair;

      const reserves = await uniswapPair.getReserves();
  
      let uniswapRate;
      if(await uniswapPair.token0() == contractInfo.authorizedPairs[selectedPair][0].addr) {
        uniswapRate = BigNumber.from(1e7).mul(reserves.reserve1).div(reserves.reserve0).toNumber() / 1e7;
      }
      else {
        uniswapRate = BigNumber.from(1e7).mul(reserves.reserve0).div(reserves.reserve1).toNumber() / 1e7;
      }
  
      uniswapRate *= 1 - UNISWAP_FEE;
  
      setPairInfo({
        crecFee: parseFloat(crecFee),
        uniswapRate
      });
    })();

  }, [selectedPair]);

  if(!provider) {
    return <InitWallet onDone={(walletInfo, account) => {
      setProvider(walletInfo);
    }}></InitWallet>
  }

  function getAmountOut() {
    if(pairInfo) {
      return inAmount * pairInfo.uniswapRate + ' ' + contractInfo!.authorizedPairs[selectedPair!][1].symbol;
    }
    else {
      return 'calculating...';
    }
  }

  function getFee() {
    if(pairInfo) {
      return (inAmount * pairInfo.crecFee + inAmount * UNISWAP_FEE) + ' ' + contractInfo!.authorizedPairs[selectedPair!][0].symbol;
    }
    else {
      return 'calculating...';
    }
  }

  async function doTrade() {

    if(!provider)
      return;

    const srcContract = new ethers.Contract(contractInfo!.authorizedPairs[selectedPair!][0].addr, FIATTOKENV2_DATA.abi, provider.getSigner()) as unknown as Ierc20;

    const approveValue = createCrecendoApproval(inAmount.toString(), selectedPair!, await provider.getBlockNumber() + 5 * 60);

    const txn = await srcContract.approve(getAddresses(await provider.getNetwork()).crecUniswap, approveValue);

    setSubmittedTxn(txn.hash);
  }

  return (
    <>
      <p>Select the trade you want to do:</p>
      <select onChange={(e) => setSelectedPair(parseInt(e.target.value))}>
        {(contractInfo ? contractInfo.authorizedPairs : []).map((p, i) => {
          return <option value={i}>{p[0].symbol} to {p[1].symbol}</option>;
        }).sort()}
      </select>
      <p>Enter the amount to trade:</p>
      <input type="number" onChange={(e) => setInAmount(parseFloat(e.target.value))} />

      <p>Fee: {getFee()}</p>
      <p>Estimated trade time: within {contractInfo ? (contractInfo.targetPeriod * 2 / 60) + ' mins' : 'calculating...'}</p>
      <p><b>Estimated amount out: {getAmountOut()}</b></p>
      <p><b>NOTE: your trade may be executed anytime within the estimated trade time above. If the price on uniswap changes during that time, your trade may differ significantly from what is shown here.</b></p>
      <p><b>NOTE: do not edit the approval amount. It is used to process your transaction.</b></p>
      <button onClick={doTrade} disabled={!getAmountOut() || !!submittedTxn}>Initiate Trade</button>

      {submittedTxn && <p>Submitted txn: {submittedTxn}</p>}
    </>
  )
}

export default CrecUniswap;