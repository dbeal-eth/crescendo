//import ethers from 'ethers';
import { expect, use } from 'chai';

import _ from 'lodash';

import {deployMockContract, MockContract, solidity} from 'ethereum-waffle';

import { ethers } from 'hardhat';
import { ethers as Ethers } from 'ethers';

//import { ethers } from 'ethers';

import { Treasury } from '../typechain/Treasury';
import { EnvLibs, EnvContracts, deployEnv } from '../scripts/code/deploy-env';
import { deployTreasury, deployTreasuryWithPool } from '../scripts/code/deploy-treasury';

use(solidity);

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

    treasury = await deployTreasuryWithPool(signer, libs, contracts.bfactory.address, [[contracts.weth.address, ethers.utils.parseEther('500')], [contracts.tokA.address, ethers.utils.parseEther('100')], [contracts.tokB.address, ethers.utils.parseEther('100')]]);

    expect(await treasury.bPool()).to.not.eql(ethers.constants.AddressZero);
    expect((await treasury.getTreasuryBalance()).toString()).to.eql(ethers.utils.parseEther('500').toString());
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
    const txn = await treasury.setRelayHub(contracts.relayHub.address, ethers.utils.parseEther('1'));

    await txn.wait(1);

    expect((await treasury.getRelayHubDeposit()).toString()).to.eql((ethers.utils.parseEther('1')).toString());
  });
});
