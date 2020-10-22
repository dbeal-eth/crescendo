import React, { useState, useEffect } from 'react';

import Portis from '@portis/web3';
import { ethers } from 'ethers';

import { RelayProvider } from '@opengsn/gsn/dist/RelayProvider';
import { resolveConfigurationGSN } from '@opengsn/gsn/dist/GSNConfigurator';

function InitWallet(props) {

  const network = 'kovan';
  const networkId = 42;

  const [msg, setMsg] = useState('');

  async function initMetamask() {
    const eth = (window as any).ethereum;
    if(!eth) {
      setMsg('Browser wallet not detected! Is it installed?');
    }

    // enable metamask
    const accounts = await eth.request({method: 'eth_requestAccounts'});

    props.onDone(new ethers.providers.Web3Provider(eth), async (paymasterAddress) => {
      const configuration = await resolveConfigurationGSN(eth, { paymasterAddress })
      return new RelayProvider(eth, configuration);
    }, accounts[0]);
  }

  async function initPortis() {

    const portis = new Portis('ce53f00c-5aaf-4287-83d6-d20948563e1c', network);

    if(portis.isLoggedIn()) {
      const provider = new ethers.providers.Web3Provider(portis.provider);

      props.onDone(provider, (await provider.listAccounts())[0])
    }
  }

  return (
    <>
      <p>Select your wallet:</p>

      <button onClick={initMetamask}>Browser Wallet/Metamask</button>
      <button onClick={initPortis}>Portis</button>

      {msg && <p>{msg}</p>}
    </>
  )
}

export default InitWallet;