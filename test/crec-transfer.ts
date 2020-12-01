//import ethers from 'ethers';
import { expect, use } from 'chai';

import {deployMockContract, MockContract, solidity} from 'ethereum-waffle';

import { ethers } from 'hardhat';
import { BigNumber, ethers as Ethers } from 'ethers';

import { CrecTransfer } from '../typechain/CrecTransfer';
import { CrecTransferFactory } from '../typechain/CrecTransferFactory';

import { EnvLibs, EnvContracts, deployEnv } from '../scripts/code/deploy-env';
import { deployTreasuryWithPool } from '../scripts/code/deploy-treasury';

import { Treasury } from '../typechain/Treasury';

import { TokenFactory } from '../typechain/TokenFactory';

use(solidity);

function createCrecendoApproval(amt: string, id: number, toId: number, deadline: number) {
  return ethers.utils.parseEther(amt)
    .add(BigNumber.from(id).shl(176))
    .add(BigNumber.from(deadline).shl(192))
    .add(BigNumber.from(toId).shl(224));
}

describe("CrecTransfer", function() {

  let signer: Ethers.Signer;

  let contracts: EnvContracts;
  let libs: EnvLibs;

  let treasury: Treasury;

  let crecTransfer: CrecTransfer;

  before(async () => {
    [ signer ] = await (<any>ethers).getSigners();

    [contracts, libs] = await deployEnv(signer);

    treasury = await deployTreasuryWithPool(signer, libs, contracts.bfactory.address, [[contracts.weth.address, ethers.utils.parseEther('500')], [contracts.tokA.address, ethers.utils.parseEther('100')], [contracts.tokB.address, ethers.utils.parseEther('100')]]);
  });

  it('deploys', async () => {
    crecTransfer = await new CrecTransferFactory(signer).deploy(treasury.address, ethers.BigNumber.from(600), ethers.utils.parseEther('300'));

    await crecTransfer.deployed();

    const txn = await treasury.setController(crecTransfer.address);
    await txn.wait(1);

    expect(await crecTransfer.targetInterval()).to.eql(600);
    expect((await crecTransfer.targetTreasuryBalance()).toString()).to.exist;
  });

  it('adds authorized token', async () => {

    const txn = crecTransfer.addAuthorizedToken(contracts.weth.address, ethers.utils.parseEther('0.001'));
    
    expect(txn)
      .to.emit(crecTransfer, 'NewAuthorizedOp');
  });

  it('allows registration of any destination address', async () => {
    const signers = await (<any>ethers).getSigners();

    const testAddr = await signers[1].getAddress();

    const myAddr = await signer.getAddress();

    await crecTransfer.register(testAddr);
    await crecTransfer.register(myAddr);

    expect(await crecTransfer.addressToId(testAddr)).to.eql(1);
    expect(await crecTransfer.addressToId(myAddr)).to.eql(2);

    expect(await crecTransfer.idToAddress(1)).to.eql(testAddr);
  });

  it.skip('calculates reward', async () => {

    // get initial reward
    await ethers.provider.send('evm_mine', []);
    const reward1 = await crecTransfer.getReward(contracts.weth.address, 3);

    expect(reward1).to.be.gt(ethers.constants.Zero, 'should be a reward available');

    // after blocks pass, reward should be gradually increasing
    await ethers.provider.send('evm_mine', []);
    const reward2 = await crecTransfer.getReward(contracts.weth.address, 3);
    expect(reward2).to.be.gt(reward1, 'reward should increase as blocks pass');

    // linear increase
    await ethers.provider.send('evm_mine', []);
    const reward3 = await crecTransfer.getReward(contracts.weth.address, 3);
    const exp = reward2.add(reward2.sub(reward1));
    expect(reward3.div(3)).to.eql(exp.div(3));
  });

  it('runs transfer with single address', async () => {
    const signers = await (<any>ethers).getSigners();

    // send some tokA and tokB to both
    await contracts.weth.transfer(await signers[1].getAddress(), ethers.utils.parseEther('100'));
    await contracts.weth.transfer(await signers[2].getAddress(), ethers.utils.parseEther('100'));

    // approve 1
    await new TokenFactory(signers[1]).attach(contracts.weth.address).approve(crecTransfer.address, createCrecendoApproval('10', 1, 2, 10000));


    const myAddr = await signer.getAddress();
    const addr1 = await signers[1].getAddress();

    const beforeAmtMy = await contracts.weth.balanceOf(myAddr);
    const beforeAmt1 = await contracts.weth.balanceOf(addr1);

    const txn = await crecTransfer.exec(1, [addr1]);
    await txn.wait(1);

    expect(await contracts.weth.balanceOf(addr1)).to.eq(beforeAmt1.sub(ethers.utils.parseEther('10')));
    expect(await contracts.weth.balanceOf(myAddr)).to.be.gt(beforeAmtMy.add(ethers.utils.parseEther('9.5')));
  });

  it('runs transfer with multiple addresses', async () => {
    const signers = await (<any>ethers).getSigners();

    // they all approve stuff
    await new TokenFactory(signers[1]).attach(contracts.weth.address).approve(crecTransfer.address, createCrecendoApproval('4', 1, 2, 10000));
    await new TokenFactory(signers[2]).attach(contracts.weth.address).approve(crecTransfer.address, createCrecendoApproval('3', 1, 2, 10000));

    const myAddr = await signer.getAddress();

    const addr1 = await signers[1].getAddress();
    const addr2 = await signers[2].getAddress();

    const beforeAmtMy = await contracts.weth.balanceOf(myAddr);
    const beforeAmt1 = await contracts.weth.balanceOf(addr1);
    const beforeAmt2 = await contracts.weth.balanceOf(addr2);

    const txn = await crecTransfer.exec(1, [addr1, addr2]);

    await txn.wait(1);

    expect(await contracts.weth.balanceOf(addr1)).to.eq(beforeAmt1.sub(ethers.utils.parseEther('4')));
    expect(await contracts.weth.balanceOf(addr2)).to.eq(beforeAmt2.sub(ethers.utils.parseEther('3')));

    expect(await contracts.weth.balanceOf(myAddr)).to.be.gt(beforeAmtMy.add(ethers.utils.parseEther('6.5')));
    expect(await contracts.weth.balanceOf(myAddr)).to.be.lt(beforeAmtMy.add(ethers.utils.parseEther('7')));
  });

  it('runs multi transfer with an invalid input address', async () => {
    const signers = await (<any>ethers).getSigners();

    // invalid (wrong crescendo id, should be ignored while others succeed)
    await new TokenFactory(signers[1]).attach(contracts.weth.address).approve(crecTransfer.address, createCrecendoApproval('2', 0, 2, 10000));

    // valid
    await new TokenFactory(signers[2]).attach(contracts.weth.address).approve(crecTransfer.address, createCrecendoApproval('1', 1, 2, 10000));

    const myAddr = await signer.getAddress();

    const addr1 = await signers[1].getAddress();
    const addr2 = await signers[2].getAddress();

    const beforeAmtMy = await contracts.weth.balanceOf(myAddr);
    const beforeAmt1 = await contracts.weth.balanceOf(addr1);
    const beforeAmt2 = await contracts.weth.balanceOf(addr2);

    const txn = await crecTransfer.exec(1, [addr1, addr2]);

    await txn.wait(1);

    expect(await contracts.weth.balanceOf(addr1)).to.eq(beforeAmt1);
    expect(await contracts.weth.balanceOf(addr2)).to.eq(beforeAmt2.sub(ethers.utils.parseEther('1')));

    expect(await contracts.weth.balanceOf(myAddr)).to.be.gt(beforeAmtMy.add(ethers.utils.parseEther('0.5')));
  });
});
