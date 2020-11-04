import React, { useState, useEffect } from 'react';
import { BigNumber, ethers } from 'ethers';

import type { CrecTransfer as CrecTransferContract } from '../../typechain/CrecTransfer';
import type { IRelayRecipient} from '../../typechain/IRelayRecipient';
import type { FiatTokenV2 } from '../../typechain/FiatTokenV2';

import { RelayProvider, resolveConfigurationGSN } from '@opengsn/gsn';
import Biconomy from '@biconomy/mexa';

import { signERC2612Permit } from 'eth-permit';

import InitWallet from './InitWallet';

//@ts-ignore
import CREC_TRANSFER_DATA = require('../../artifacts/CrecTransfer.json');
//@ts-ignore
import FIATTOKENV2_DATA = require('../../artifacts/FiatTokenV2.json');

import { getAddresses, getBiconomyKey } from '../networks';

interface TokenInfo {
  name: string,
  symbol: string,
  addr: string
}

interface CrecTransferContractInfo {
  // src, dest, uniswap pair address
  tokens: TokenInfo[],
  targetPeriod: number;
  treasuryAddress: string;
}

interface PairInfo {
  crecFee: BigNumber;
}

function createCrecendoApproval(amt: string, toId: number, idx: number) {
  return ethers.utils.parseEther(amt)
    .add(BigNumber.from(idx).shl(192))
    .add(BigNumber.from(toId).shl(224));
}

function CrecTransfer() {
  const [provider, setProvider] = useState<ethers.providers.Web3Provider | null>();
  const [gsnProvider, setGsnProvider] = useState<ethers.providers.Web3Provider | null>();
  const [biconomyProvider, setBiconomyProvider] = useState<ethers.providers.Web3Provider | null>();

  const [contractInfo, setContractInfo] = useState<CrecTransferContractInfo|null>();
  const [pairInfo, setPairInfo] = useState<PairInfo|null>();

  const [selectedToken, setSelectedToken] = useState<TokenInfo|null>();
  const [destAddress, setDestAddress] = useState('');
  const [destAddressId, setDestAddressId] = useState<number|null>();
  const [inAmount, setInAmount] = useState(0);

  const [submittedTxn, setSubmittedTxn] = useState<string|null>();

  // contract loading
  useEffect(() => {

    (async () => {

      if(!provider)
        return;
      
      console.log('AAAAAA', getAddresses(await provider.getNetwork()).crecTransfer);

      const crec = new ethers.Contract(getAddresses(await provider.getNetwork()).crecTransfer, CREC_TRANSFER_DATA.abi, provider) as unknown as CrecTransferContract;

      const treasuryAddress = await crec.treasury();

      const tokens = await crec.queryFilter(crec.filters.NewAuthorizedToken(null));

      const newContractInfo: CrecTransferContractInfo = {
        targetPeriod: await crec.targetInterval(),
        tokens: [],
        treasuryAddress
      };

      console.log('loaded contract info', newContractInfo);

      // resolve tokens
      for(const token of tokens) {
        if(!token.args)
          continue;

        console.log(token.args);

        const t = new ethers.Contract(token.args[0], FIATTOKENV2_DATA.abi, provider) as unknown as FiatTokenV2;

        try {
          const name = await t.name();
          const symbol = await t.symbol();
  
          newContractInfo.tokens.push({
            name,
            symbol,
            addr: token.args[0]
          });
        } catch(err) {
          newContractInfo.tokens.push({
            name: 'Unknown',
            symbol: 'UNK',
            addr: token.args[0]
          })
        }
      }

      console.log('loaded tokens', newContractInfo.tokens);

      const configuration = await resolveConfigurationGSN(provider.provider as any, { paymasterAddress: newContractInfo.treasuryAddress })

      // for special compatibility with portis
      configuration.methodSuffix ="_v3";
      configuration.jsonStringifyRequest = true;

      setContractInfo(newContractInfo);
      setGsnProvider(new ethers.providers.Web3Provider(new RelayProvider(provider.provider as any, configuration) as any));

      const biconomyConfig = {
        apiKey: getBiconomyKey(provider.network)
      };

      setBiconomyProvider(new ethers.providers.Web3Provider(new Biconomy(provider.provider, biconomyConfig)));

      if(tokens.length)
        setSelectedToken(newContractInfo.tokens[0]);

    })();
  }, [provider]);

  useEffect(() => {

    (async () => {
      if(!provider || !selectedToken)
        return;

      const crec = new ethers.Contract(getAddresses(await provider.getNetwork()).crecTransfer, CREC_TRANSFER_DATA.abi, provider) as unknown as CrecTransferContract;

      const fee = await crec.tokenFee(selectedToken.addr);

      setPairInfo({crecFee: fee});
    })();

  }, [selectedToken]);

  // find dest address id
  useEffect(() => {
  
      (async () => {
  
        if(!provider || !destAddress)
          return;

        const crec = new ethers.Contract(getAddresses(await provider.getNetwork()).crecTransfer, CREC_TRANSFER_DATA.abi, provider) as unknown as CrecTransferContract;

        const id = await crec.addressToId(destAddress);

        setDestAddressId(id);
      })();

  }, [destAddress]);

  if(!provider) {
    return <InitWallet onDone={async (walletInfo, account) => {
      setProvider(walletInfo);
    }}></InitWallet>
  }

  function getFee() {
    if(pairInfo) {
      return ethers.utils.formatEther(pairInfo.crecFee);
    }
    else {
      return 'calculating...';
    }
  }

  async function registerDestination() {

    if(!gsnProvider)
      return;

    setDestAddressId(null);

    const crec = new ethers.Contract(getAddresses(await gsnProvider.getNetwork()).crecTransfer, CREC_TRANSFER_DATA.abi, gsnProvider.getSigner()) as unknown as CrecTransferContract;
    // something is wierd with the "min gas price" for usage of kovan opengsn
    const txn = await crec.register(destAddress, {gasPrice: 60000000000});
    const rcpt = await txn.wait(1);

    const id = rcpt.events!.find(e => e.event === 'NewRegistration')!.args![1];

    setDestAddressId(id);
  }

  async function doTrade(gasless = false) {

    if(!provider || !gsnProvider || !selectedToken || !destAddressId)
      return;
    
    const blockNum = await provider.getBlockNumber();

    let txn;

    const senderAddr = await provider.getSigner().getAddress();
    const spenderAddr = getAddresses(await provider.getNetwork()).crecTransfer;
    const amt = createCrecendoApproval(inAmount.toString(), destAddressId, blockNum + 600);

    if(gasless) {
      console.log('trying gasless');
      const srcContract = new ethers.Contract(selectedToken!.addr, FIATTOKENV2_DATA.abi, gsnProvider.getSigner()) as unknown as FiatTokenV2;

      // we can send gasless transactions either 1) through GSN if the token contract supports it 2) through permit function
      try {
        // make sure this is compatible with GSN
        console.log('check gsn compatible');
        await (srcContract as unknown as IRelayRecipient).versionRecipient();
        txn = await srcContract.approve(getAddresses(await provider.getNetwork()).crecTransfer, createCrecendoApproval(inAmount.toString(), destAddressId, blockNum + 600));
      } catch(err) {
        console.log('incompatible with GSN token, trying permit...');
        console.log('HELLO', srcContract.address, senderAddr, spenderAddr, amt.toHexString());

        const permit = await signERC2612Permit(
          provider.getSigner().provider, 
          srcContract.address, 
          senderAddr, 
          spenderAddr, 
          amt.toHexString()
        );

        console.log('got permit', permit);
  
        txn = await srcContract.permit(senderAddr, spenderAddr, amt, permit.deadline, permit.v, permit.r, permit.s);
      }
    }
    else {
      const srcContract = new ethers.Contract(selectedToken!.addr, FIATTOKENV2_DATA.abi, provider.getSigner()) as unknown as FiatTokenV2;
      console.log(getAddresses(await provider.getNetwork()).crecTransfer, createCrecendoApproval(inAmount.toString(), destAddressId, blockNum + 600))
      txn = await srcContract.approve(getAddresses(await provider.getNetwork()).crecTransfer, createCrecendoApproval(inAmount.toString(), destAddressId, blockNum + 600));
    }

    setSubmittedTxn(txn.hash);
  }

  return (
    <>
      <p>Select the token you want to send:</p>
      <select onChange={(e) => setSelectedToken(contractInfo!.tokens[e.target.value])}>
        {(contractInfo ? contractInfo.tokens : []).map((token, i) => {
          return <option value={i}>{token.symbol} ({token.name})</option>;
        })}
      </select>

      <p>Enter the destination address:</p>
      <input type="text" placeholder="0x0000..." onChange={(e) => setDestAddress(e.target.value)} />

      <p>Enter the amount to send:</p>
      <input type="number" step="0.01" onChange={(e) => setInAmount(parseFloat(e.target.value))} />

      <p>Fee: {getFee()} {selectedToken?.symbol}</p>
      <p>Estimated send time: within {contractInfo ? (contractInfo.targetPeriod * 2 / 60) + ' mins' : 'calculating...'}</p>
      <p><b>NOTE: do not edit the approval amount. It is used to process your transaction.</b></p>
      
      <div>
        <button onClick={registerDestination} disabled={!destAddress || destAddressId !== 0}>Register Destination</button>
      </div>
      
      <button onClick={() => { doTrade(true) }} disabled={!inAmount || !destAddressId || !!submittedTxn}>Transfer Gasless</button>
      <button onClick={() => { doTrade(false) }} disabled={!inAmount || !destAddressId || !!submittedTxn}>Transfer Regular</button>

      {submittedTxn && <p>Submitted txn: {submittedTxn}</p>}
    </>
  )
}

export default CrecTransfer;