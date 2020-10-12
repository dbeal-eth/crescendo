import _ from 'lodash';

import { ethers } from '@nomiclabs/buidler';

import { ethers as Ethers } from "ethers";

import { RightsManagerFactory } from '../typechain/RightsManagerFactory';
import { SmartPoolManagerFactory } from '../typechain/SmartPoolManagerFactory';

import { BFactoryFactory } from '../typechain/BFactoryFactory';
import { BFactory } from '../typechain/BFactory';

import { RelayHubFactory } from '../typechain/RelayHubFactory';
import { RelayHub } from '../typechain/RelayHub';

import { TokenFactory } from '../typechain/TokenFactory';
import { Token } from '../typechain/Token';

import { Weth9Factory } from '../typechain/Weth9Factory'
import { Weth9 } from '../typechain/Weth9';

import { Treasury } from '../typechain/Treasury';
import { TreasuryFactory } from '../typechain/TreasuryFactory';
import { CrpTreasuryFactoryFactory } from '../typechain/CrpTreasuryFactoryFactory';
import { CrpTreasuryFactory } from '../typechain/CrpTreasuryFactory';

export interface EnvContracts {
    bfactory: BFactory,
    relayHub: RelayHub,
    weth: Weth9,
    tokA: Token,
    tokB: Token,
    tokC: Token
}

//export interface EnvLibs {
//    [id: string]: any
//}

export type EnvLibs = any;

export const MAX = ethers.constants.MaxUint256;

const RELAY_HUB_CONFIG = {
  gasOverhead: 35965,
  postOverhead: 13950,
  gasReserve: 100000,
  maxWorkerCount: 10,
  minimumStake: 1e18.toString(),
  minimumUnstakeDelay: 1000,
  maximumRecipientDeposit: 2e18.toString()
}


export async function deployLibs(signer: Ethers.Signer) {
    const rightsManager = await new RightsManagerFactory(signer).deploy();
    const smartPoolManager = await new SmartPoolManagerFactory(signer).deploy();
  
    // safe math does not have an ABI for some reason...?
    const safeMath = await (await ethers.getContractFactory("BalancerSafeMath")).deploy();
  
    await safeMath.deployed();
  
    return {
      "__$4c38f6d953980cddd3b3b35f19465719a4$__": smartPoolManager.address,
      "__$d299c529ae9894de884ff0b1c314d5e4d5$__": rightsManager.address,
      "__$3090edb928940b408c0d9b35a986dbcddb$__": safeMath.address,
    };
}

export async function deployEnv(signer: Ethers.Signer): Promise<[ EnvContracts, EnvLibs ]> {

    const contracts: EnvContracts = (<EnvContracts>{});

    // deploy libs
    const libs = await deployLibs(signer);

    // deploy bfactory
    const bFactory = new BFactoryFactory(signer);

    contracts.bfactory = await bFactory.deploy();

    // deploy GSN relayhub
    contracts.relayHub = await new RelayHubFactory(signer).deploy(
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      RELAY_HUB_CONFIG.maxWorkerCount,
      RELAY_HUB_CONFIG.gasReserve,
      RELAY_HUB_CONFIG.postOverhead,
      RELAY_HUB_CONFIG.gasOverhead,
      RELAY_HUB_CONFIG.maximumRecipientDeposit,
      RELAY_HUB_CONFIG.minimumUnstakeDelay,
      RELAY_HUB_CONFIG.minimumStake
    )

    // deploy tokens
    contracts.weth = await new Weth9Factory(signer).deploy();
    await contracts.weth.deposit({
      value: ethers.utils.parseEther('1000')
    });

    const tokenFactory = new TokenFactory(signer);

    contracts.tokA = await tokenFactory.deploy('Token A', 'TOKA', MAX);
    contracts.tokB = await tokenFactory.deploy('Token B', 'TOKB', MAX);
    contracts.tokC = await tokenFactory.deploy('Token C', 'TOKC', MAX);

    await contracts.tokC.deployed();

    return [ contracts, libs ];
}

export async function deployTreasury(signer: Ethers.Signer, contracts: EnvContracts, libs: EnvLibs): Promise<Treasury> {


    // deploy treasury factory
    const factory = await new CrpTreasuryFactoryFactory(libs, signer).deploy();

    await factory.deployed();

    // tell the factory to deploy a treasury itself
    let txn = await factory.newTreasury(contracts.bfactory.address, {
      poolTokenSymbol: 'TREAS',
      poolTokenName: 'Treasury',
      constituentTokens: [contracts.weth.address, contracts.tokA.address, contracts.tokB.address, contracts.tokC.address],
      tokenBalances: [ethers.utils.parseEther('300'), ethers.utils.parseEther('100'), ethers.utils.parseEther('100'), ethers.utils.parseEther('100')],
      tokenWeights: [ethers.utils.parseEther('9'), ethers.utils.parseEther('3'), ethers.utils.parseEther('3'), ethers.utils.parseEther('3')],
      swapFee: ethers.utils.parseEther('0.000001'),
    }, {
      canPauseSwapping: true,
      canChangeSwapFee: false,
      canChangeWeights: true,
      canAddRemoveTokens: true,
      canWhitelistLPs: true,
      canChangeCap: true,
    });

    const rcpt = await txn.wait(1);

    return new TreasuryFactory(libs, signer).attach(_.find(rcpt.events, e => e.event === 'LogNewTreasury')!.args![1])
}