//import ethers from 'ethers';
import { expect, use } from 'chai';

import {deployMockContract, MockContract, solidity} from 'ethereum-waffle';

import { ethers } from 'hardhat';
import { ethers as Ethers } from 'ethers';

import { CrecUniswapAir } from '../typechain/CrecUniswapAir';
import { CrecUniswapAir__factory } from '../typechain/factories/CrecUniswapAir__factory';

import { EnvLibs, EnvContracts, deployEnv } from '../scripts/code/deploy-env';
import { deployTreasury, deployTreasuryWithPool } from '../scripts/code/deploy-treasury';

import { Treasury } from '../typechain/Treasury';

import { Token__factory } from '../typechain/factories/Token__factory';
import _ from 'lodash';

use(solidity);

function createCrecendoApproval(amt: string, id: number, deadline: number, minTradeAmount = '0') {
  return ethers.utils.parseEther(amt)
    .add(ethers.BigNumber.from(deadline).shl(128))
    .add(ethers.BigNumber.from(id).shl(160))
    .add(ethers.utils.parseEther(minTradeAmount).shl(176));
}

describe("CrecUniswapAir", function() {
  this.timeout(300000);

  let signer: Ethers.Signer;

  let contracts: EnvContracts;
  let libs: EnvLibs;

  let treasury: Treasury;

  let crecUniswap: CrecUniswapAir;

  let uniswapPair: MockContract;

  before(async () => {
    [ signer ] = await (<any>ethers).getSigners();

    [contracts, libs] = await deployEnv(signer);

    treasury = await deployTreasuryWithPool(signer, libs, contracts.bfactory.address, [[contracts.weth.address, ethers.utils.parseEther('500')], [contracts.tokA.address, ethers.utils.parseEther('100')], [contracts.tokB.address, ethers.utils.parseEther('100')]]);
  });

  it('deploys', async () => {
    crecUniswap = await new CrecUniswapAir__factory(signer).deploy(treasury.address, ethers.BigNumber.from(600), ethers.utils.parseEther('300'));

    await crecUniswap.deployed();

    const txn = await treasury.setController(crecUniswap.address);
    await txn.wait(1);

    expect(await crecUniswap.targetInterval()).to.eql(600);
    expect((await crecUniswap.targetTreasuryBalance()).toString()).to.exist;
  });

  it('adds authorized pair', async () => {

    // create a fake uniswap pair
    uniswapPair = await deployMockContract(signer, require('../artifacts/@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol/IUniswapV2Pair.json').abi);

    await uniswapPair.mock.token0.returns(contracts.tokA.address);
    await uniswapPair.mock.token1.returns(contracts.tokB.address);

    const txn = crecUniswap.addAuthorizedPair(uniswapPair.address, ethers.utils.parseUnits('1', 'gwei'));
    
    expect(txn)
      .to.emit(crecUniswap, 'NewAuthorizedOp');

    //await txn.wait(1);
  });

  // currently skipped because I cannot figure out why the provider commands are not working as expected
  it.skip('calculates reward', async () => {
    // get initial reward
    await ethers.provider.send('evm_increaseTime', [5000]);
    await ethers.provider.send('evm_mine', []);
    await ethers.provider.send('evm_mine', []);
    const reward1 = await crecUniswap.getReward(1, 3);

    expect(reward1).to.be.gt(ethers.constants.Zero, 'should be a reward available');

    // after blocks pass, reward should be gradually increasing
    await ethers.provider.send('evm_mine', []);
    const reward2 = await crecUniswap.getReward(1, 3);
    expect(reward2).to.be.gt(reward1, 'reward should increase as aws pass');

    // linear increase
    await ethers.provider.send('evm_mine', []);
    const reward3 = await crecUniswap.getReward(1, 3);
    const exp = reward2.add(reward2.sub(reward1));
    expect(reward3.div(10)).to.eql(exp.div(10));
  });

  it('runs empty trade sequence', async () => {
    await crecUniswap.exec(1, []);
  });

  it('calculates op id', async () => {
    expect(await crecUniswap.calculateOpId(createCrecendoApproval('1',  54, 10000))).to.eql(54);
  });

  it('detects correct trade values', async () => {
    
    const signers = await (<any>ethers).getSigners();

    expect(await crecUniswap.calculateApproveValue(contracts.tokA.address, 1, await signers[1].getAddress())).to.eq(ethers.constants.Zero);

    await uniswapPair.mock.getReserves.returns(ethers.utils.parseEther('100'), ethers.utils.parseEther('100'), 0);
    await uniswapPair.mock.swap.returns();

    await contracts.tokA.transfer(await signers[1].getAddress(), ethers.utils.parseEther('100'));
    await contracts.tokB.transfer(await signers[1].getAddress(), ethers.utils.parseEther('100'));
    await contracts.tokA.transfer(await signers[2].getAddress(), ethers.utils.parseEther('100'));
    await contracts.tokB.transfer(await signers[2].getAddress(), ethers.utils.parseEther('100'));
    await contracts.tokA.transfer(await signers[3].getAddress(), ethers.utils.parseEther('100'));
    await contracts.tokB.transfer(await signers[3].getAddress(), ethers.utils.parseEther('100'));

    // they all approve stuff
    await new Token__factory(signers[1]).attach(contracts.tokA.address).approve(crecUniswap.address, createCrecendoApproval('1',  1, 10000));
    await new Token__factory(signers[2]).attach(contracts.tokA.address).approve(crecUniswap.address, createCrecendoApproval('2',  1, 10000));
    await new Token__factory(signers[3]).attach(contracts.tokA.address).approve(crecUniswap.address, createCrecendoApproval('4',  1, 10000));

    expect(await crecUniswap.calculateApproveValue(contracts.tokA.address, 1, await signers[1].getAddress())).to.be.gt(ethers.constants.Zero);

    expect(await crecUniswap.calculateApproveValue(contracts.tokA.address, 2, await signers[1].getAddress())).to.eq(ethers.constants.Zero);
  });

  it('runs the trade sequence', async () => {
    const signers = await (<any>ethers).getSigners();

    // send some fake money for the return
    await contracts.tokB.transfer(crecUniswap.address, ethers.utils.parseEther('100'));

    // test going one way

    await crecUniswap.exec(1, [
      await signers[1].getAddress(),
      await signers[2].getAddress(),
      await signers[3].getAddress()
    ]);

    expect(await contracts.tokA.balanceOf(uniswapPair.address)).to.be.gt(ethers.utils.parseEther('6'));

    // test the other way
    await new Token__factory(signers[1]).attach(contracts.tokB.address).approve(crecUniswap.address, createCrecendoApproval('16', 1, 10000));
    await new Token__factory(signers[2]).attach(contracts.tokB.address).approve(crecUniswap.address, createCrecendoApproval('8',  1, 10000));
    await new Token__factory(signers[3]).attach(contracts.tokB.address).approve(crecUniswap.address, createCrecendoApproval('32', 1, 10000));

    await contracts.tokA.transfer(crecUniswap.address, ethers.utils.parseEther('100'));

    await crecUniswap.exec(1, [
      await signers[1].getAddress(),
      await signers[2].getAddress(),
      await signers[3].getAddress()
    ]);

    expect(await contracts.tokB.balanceOf(uniswapPair.address)).to.be.gt(ethers.utils.parseEther('54'));

    console.log('done with 2');

    // now test both ways with airswap
    await contracts.tokB.transfer(await signers[4].getAddress(), ethers.utils.parseEther('1'));
    await contracts.tokA.transfer(await signers[5].getAddress(), ethers.utils.parseEther('2'));
    await contracts.tokB.transfer(await signers[6].getAddress(), ethers.utils.parseEther('3'));


    await new Token__factory(signers[4]).attach(contracts.tokB.address).approve(crecUniswap.address, createCrecendoApproval('1', 1, 10000));
    await new Token__factory(signers[5]).attach(contracts.tokA.address).approve(crecUniswap.address, createCrecendoApproval('2', 1, 10000));
    await new Token__factory(signers[6]).attach(contracts.tokB.address).approve(crecUniswap.address, createCrecendoApproval('3', 1, 10000));

    const prevUniTokenA = await contracts.tokA.balanceOf(uniswapPair.address);

    await crecUniswap.exec(1, [
      await signers[4].getAddress(),
      await signers[5].getAddress(),
      await signers[6].getAddress()
    ]);

    expect(await contracts.tokB.balanceOf(signers[4].getAddress())).to.eq(ethers.BigNumber.from(0));
    expect(await contracts.tokA.balanceOf(signers[5].getAddress())).to.eq(ethers.BigNumber.from(0));
    expect(await contracts.tokB.balanceOf(signers[6].getAddress())).to.eq(ethers.BigNumber.from(0));

    expect(await contracts.tokA.balanceOf(signers[4].getAddress())).to.be.gt(ethers.utils.parseEther('0.95'));
    expect(await contracts.tokB.balanceOf(signers[5].getAddress())).to.be.gt(ethers.utils.parseEther('1.9'));
    expect(await contracts.tokA.balanceOf(signers[6].getAddress())).to.be.gt(ethers.utils.parseEther('2.85'));

    // since this is an air transaction, no A tokens should have been sent to uniswap
    expect(await contracts.tokA.balanceOf(uniswapPair.address)).to.be.eq(prevUniTokenA);
  });

  it('can claim owed', async () => {
    const balBefore = await contracts.weth.balanceOf(await signer.getAddress());

    await crecUniswap.claim(await signer.getAddress());

    expect(await contracts.weth.balanceOf(await signer.getAddress())).to.be.gt(balBefore);
  });

  it('can fill', async() => {
    const balBefore = await contracts.weth.balanceOf(await signer.getAddress());
    const amt = ethers.utils.parseEther('0.1');
    
    await contracts.weth.approve(crecUniswap.address, amt);
    await crecUniswap.fill(amt);
    expect(await contracts.weth.balanceOf(await signer.getAddress())).to.be.lt(balBefore);
  });

  it('trades 150 addresses in one exec', async () => {

    const addrs: string[] = [];
    const signers = await ethers.getSigners();

    for(let i = 1;i < 150;i++) {

      const tmpAddr = await signers[i].getAddress();

      await contracts.tokA.transfer(tmpAddr, ethers.utils.parseEther(i.toString()));    

      await new Token__factory(signers[i]).attach(contracts.tokA.address).approve(crecUniswap.address, createCrecendoApproval(i.toString(), 1, 100000));

      addrs.push(tmpAddr);
    }

    // make sure the contract has enough ether
    await contracts.tokB.transfer(crecUniswap.address, ethers.utils.parseEther('1000'));

    const txn = await crecUniswap.exec(1, addrs);
    const r = await txn.wait();

    // should fit in the block limit
    console.log('gas used', r.gasUsed);
    expect(r.gasUsed).to.be.lte(10000000);
  });
});
