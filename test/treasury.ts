//import ethers from 'ethers';
import { expect } from 'chai';

import _ from 'lodash';

import { ethers } from '@nomiclabs/buidler';
import { ethers as Ethers } from 'ethers';

//import { ethers } from 'ethers';

import { Treasury } from '../typechain/Treasury';
import { EnvLibs, EnvContracts, deployEnv, deployTreasury } from './helper';

describe("Treasury", function() {

  let signer: Ethers.Signer;

  let myAddress: string;

  let contracts: EnvContracts;
  let libs: EnvLibs;

  let treasury: Treasury;

  before(async () => {
    [ signer ] = await (<any>ethers).getSigners();
    
    myAddress = await signer.getAddress();

    [ contracts, libs ] = await deployEnv(signer);
  })

  it('deploys', async () => {

    treasury = await deployTreasury(signer, contracts, libs);

    expect(treasury).to.exist;

    await contracts.weth.approve(treasury.address, ethers.constants.MaxUint256);
    await contracts.tokA.approve(treasury.address, ethers.constants.MaxUint256);
    await contracts.tokB.approve(treasury.address, ethers.constants.MaxUint256);
    let approveTxn = await contracts.tokC.approve(treasury.address, ethers.constants.MaxUint256);

    await approveTxn.wait(1);

    let txn = await treasury["createPool(uint256)"](ethers.utils.parseEther((10000).toString()));

    await txn.wait(1);

    expect(await treasury.bPool()).to.not.eql(ethers.constants.AddressZero);
  });

  it('withdraws', async () => {

    const balBefore = await contracts.weth.balanceOf(myAddress);

    const amt = ethers.utils.parseEther('1');
    const txn = await treasury.withdraw(contracts.weth.address, myAddress, amt);
    await txn.wait(1);

    const balAfter = await contracts.weth.balanceOf(myAddress);

    expect(ethers.utils.formatEther(balAfter.sub(balBefore))).to.eql('1.0');
  });

  it('deposits', async () => {
    const balBefore = await contracts.weth.balanceOf(myAddress);

    const amt = ethers.utils.parseEther('1');
    const txn = await treasury.deposit(contracts.weth.address, myAddress, amt);
    await txn.wait(1);

    const balAfter = await contracts.weth.balanceOf(myAddress);

    expect(ethers.utils.formatEther(balAfter.sub(balBefore))).to.eql('-1.0');
  })

  it('funds relayhub', async () => {
    const txn = await treasury.setRelayHub(contracts.relayHub.address);

    await txn.wait(1);

    expect((await treasury.getRelayHubDeposit()).toString()).to.eql((await treasury.TARGET_RELAYHUB_DEPOSIT()).toString());
  });

  it('serves as paymaster for owner', async () => {

  });
});
