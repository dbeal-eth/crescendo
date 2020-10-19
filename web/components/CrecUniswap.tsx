import React, { useState, useEffect } from 'react';
import { BigNumber, ethers } from 'ethers';

import type { CrecUniswap as CrecUniswapContract } from '../../typechain/CrecUniswap';
import type { IUniswapV2Pair } from '../../typechain/IUniswapV2Pair';
import type { Ierc20 } from '../../typechain/Ierc20';

import InitWallet from './InitWallet';

//@ts-ignore
import CREC_UNISWAP_DATA = require('text!artifacts/CrecUniswap.json');
//@ts-ignore
import IERC20_DATA = require('text!artifacts/IERC20.json');
//@ts-ignore
import UNISWAP_PAIR_DATA = require('text!artifacts/IUniswapV2Pair.json');

const CREC_UNISWAP_ADDRESS = '0x5bcb88A0d20426e451332eE6C4324b0e663c50E0';

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

function createCrecendoApproval(amt: string, idx: number) {
  let v = ethers.utils.parseEther(amt)
  
  // bottom 4 bytes are reserved for data
  const mask = ethers.BigNumber.from(Math.pow(2, 32));
  v = v.add(mask.sub(v.mod(mask)));

  // add the idx (bottom 16)
  v = v.add(idx);
  
  return v;
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

      const crecUniswap = new ethers.Contract(CREC_UNISWAP_ADDRESS, JSON.parse(CREC_UNISWAP_DATA).abi, provider) as unknown as CrecUniswapContract;

      const pairs = await crecUniswap.queryFilter(crecUniswap.filters.NewAuthorizedPair(null, null, null, null));

      const newContractInfo: CrecUniswapContractInfo = {
        targetPeriod: await crecUniswap.targetInterval(),
        authorizedPairs: []
      };

      // resolve tokens
      const tokens: {[addr: string]: TokenInfo} = {};
      for(const pair of pairs) {
        if(!pair.args)
          continue;

        if(tokens[pair.args[1]]) {
          const t = new ethers.Contract(pair.args[1], JSON.parse(IERC20_DATA).abi, provider) as unknown as Ierc20;

          const name = await t.name();
          const symbol = await t.symbol();
          
          tokens[pair.args[1]] = {
            name,
            symbol,
            addr: pair.args[1]
          };
        }

        if(tokens[pair.args[2]]) {
          const t = new ethers.Contract(pair.args[2], JSON.parse(IERC20_DATA).abi, provider) as unknown as Ierc20;
    
          const name = await t.name();
          const symbol = await t.symbol();
          
          tokens[pair.args[2]] = {
            name,
            symbol,
            addr: pair.args[2]
          };
        }

        newContractInfo.authorizedPairs[pair.args[0]] = [tokens[pair.args[1]], tokens[pair.args[2]], pair.args[3]];
      }

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

      const crecUniswap = new ethers.Contract(CREC_UNISWAP_ADDRESS, JSON.parse(CREC_UNISWAP_DATA).abi) as unknown as CrecUniswapContract;

      // get fee
      const crecFee = (await crecUniswap.pairFee(selectedPair)).toNumber();
  
      // get trading rate
      const uniswapPair = new ethers.Contract(CREC_UNISWAP_ADDRESS, JSON.parse(UNISWAP_PAIR_DATA).abi) as unknown as IUniswapV2Pair;
  
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
        crecFee,
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

    const srcContract = new ethers.Contract(contractInfo!.authorizedPairs[selectedPair!][0].addr, JSON.parse(IERC20_DATA).abi, provider.getSigner()) as unknown as Ierc20;

    const txn = await srcContract.approve(CREC_UNISWAP_ADDRESS, createCrecendoApproval(inAmount.toString(), selectedPair!));

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
      <button onClick={doTrade} disabled={!!getAmountOut() && !submittedTxn}>Initiate Trade</button>

      {submittedTxn && <p>Submitted txn: {submittedTxn}</p>}
    </>
  )
}

export default CrecUniswap;