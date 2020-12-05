//import ethers from 'ethers';
import { expect, use } from 'chai';

import {deployMockContract, MockContract, solidity} from 'ethereum-waffle';

import { ethers } from 'hardhat';
import { ethers as Ethers } from 'ethers';

import { CrecUniswap } from '../typechain/CrecUniswap';
import { CrecUniswap__factory } from '../typechain/factories/CrecUniswap__factory';

import { EnvLibs, EnvContracts, deployEnv } from '../scripts/code/deploy-env';
import { deployTreasury, deployTreasuryWithPool } from '../scripts/code/deploy-treasury';

import { Treasury } from '../typechain/Treasury';

import { Token__factory } from '../typechain/factories/Token__factory';

use(solidity);

function createCrecendoApproval(amt: string, idx: number) {
  let v = ethers.utils.parseEther(amt)
  
  // bottom 4 bytes are reserved for data
  const mask = ethers.BigNumber.from(Math.pow(2, 32));
  v = v.add(mask.sub(v.mod(mask)));

  // add the idx (bottom 16)
  v = v.add(idx);
  
  return v;
}

describe("CrecUniswap", function() {

  let signer: Ethers.Signer;

  let contracts: EnvContracts;
  let libs: EnvLibs;

  let treasury: Treasury;

  let crecUniswap: CrecUniswap;

  let uniswapPair: MockContract;

  before(async () => {
    [ signer ] = await (<any>ethers).getSigners();

    [contracts, libs] = await deployEnv(signer);

    treasury = await deployTreasuryWithPool(signer, libs, contracts.bfactory.address, [[contracts.weth.address, ethers.utils.parseEther('500')], [contracts.tokA.address, ethers.utils.parseEther('100')], [contracts.tokB.address, ethers.utils.parseEther('100')]]);
  });

  it('deploys', async () => {
    crecUniswap = await new CrecUniswap__factory(signer).deploy(treasury.address, ethers.BigNumber.from(600), ethers.utils.parseEther('300'));

    await crecUniswap.deployed();

    const txn = await treasury.setController(crecUniswap.address);
    await txn.wait(1);

    expect(await crecUniswap.targetInterval()).to.eql(600);
    expect((await crecUniswap.targetTreasuryBalance()).toString()).to.exist;
  });

  it('adds authorized pair', async () => {

    // create an uniswap pair
    uniswapPair = await deployMockContract(signer, require('../artifacts/@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol/IUniswapV2Pair.json').abi);

    await uniswapPair.mock.token0.returns(contracts.tokA.address);
    await uniswapPair.mock.token1.returns(contracts.tokB.address);

    const txn = crecUniswap.addAuthorizedPair(uniswapPair.address);
    
    expect(txn)
      .to.emit(crecUniswap, 'NewAuthorizedPair');

    //await txn.wait(1);
  });

  it('marks after approval', async () => {

    const signers = await (<any>ethers).getSigners();

    //const txn = await crecUniswap.mark(1, signers[1]);

    expect(crecUniswap.mark(1, await signers[1].getAddress())).to.be.reverted;

    //await txn.wait(1);

    // send some tokA and tokB to both
    await contracts.tokA.transfer(await signers[1].getAddress(), ethers.utils.parseEther('100'));
    await contracts.tokB.transfer(await signers[1].getAddress(), ethers.utils.parseEther('100'));
    await contracts.tokA.transfer(await signers[2].getAddress(), ethers.utils.parseEther('100'));
    await contracts.tokB.transfer(await signers[2].getAddress(), ethers.utils.parseEther('100'));
    await contracts.tokA.transfer(await signers[3].getAddress(), ethers.utils.parseEther('100'));
    await contracts.tokB.transfer(await signers[3].getAddress(), ethers.utils.parseEther('100'));

    // they all approve stuff
    await new Token__factory(signers[1]).attach(contracts.tokA.address).approve(crecUniswap.address, createCrecendoApproval('1',  1));
    await new Token__factory(signers[1]).attach(contracts.tokB.address).approve(crecUniswap.address, createCrecendoApproval('16', 2));
    await new Token__factory(signers[2]).attach(contracts.tokA.address).approve(crecUniswap.address, createCrecendoApproval('2',  1));
    await new Token__factory(signers[2]).attach(contracts.tokB.address).approve(crecUniswap.address, createCrecendoApproval('8',  2));
    await new Token__factory(signers[3]).attach(contracts.tokA.address).approve(crecUniswap.address, createCrecendoApproval('4',  1));
    await (await new Token__factory(signers[3]).attach(contracts.tokB.address).approve(crecUniswap.address, createCrecendoApproval('32', 2))).wait(1);

    await crecUniswap.mark(1, await signers[1].getAddress());
  });

  it.skip('calculates reward', async () => {

    // get initial reward
    await ethers.provider.send('evm_mine', []);
    const reward1 = await crecUniswap.getReward(1, 3);

    expect(reward1).to.be.gt(ethers.constants.Zero, 'should be a reward available');

    // after blocks pass, reward should be gradually increasing
    await ethers.provider.send('evm_mine', []);
    const reward2 = await crecUniswap.getReward(1, 3);
    expect(reward2).to.be.gt(reward1, 'reward should increase as blocks pass');

    // linear increase
    await ethers.provider.send('evm_mine', []);
    const reward3 = await crecUniswap.getReward(1, 3);
    const exp = reward2.add(reward2.sub(reward1));
    expect(reward3.div(3)).to.eql(exp.div(3).add(1));
  });

  it('runs the trade sequence', async () => {

    const signers = await (<any>ethers).getSigners();

    await uniswapPair.mock.getReserves.returns(ethers.utils.parseEther('100'), ethers.utils.parseEther('100'), 0);
    await uniswapPair.mock.swap.returns();

    // send some fake money for the return
    await contracts.tokB.transfer(crecUniswap.address, ethers.utils.parseEther('100'));

    await crecUniswap.exec(1, [
      await signers[1].getAddress(),
      await signers[2].getAddress(),
      await signers[3].getAddress()
    ]);

    expect(await contracts.tokA.balanceOf(uniswapPair.address)).to.be.gt(ethers.utils.parseEther('6'));

    await contracts.tokA.transfer(crecUniswap.address, ethers.utils.parseEther('100'));

    // still need to mark 2
    await crecUniswap.mark(2, await signers[1].getAddress());

    await crecUniswap.exec(2, [
      await signers[1].getAddress(),
      await signers[2].getAddress(),
      await signers[3].getAddress()
    ]);

    expect(await contracts.tokB.balanceOf(uniswapPair.address)).to.be.gt(ethers.utils.parseEther('54'));
  });
});
