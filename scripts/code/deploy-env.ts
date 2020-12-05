import _ from 'lodash';

import bre from 'hardhat';

import { ethers } from 'hardhat';

import { ethers as Ethers } from "ethers";

import { RightsManager__factory } from '../../typechain/factories/RightsManager__factory';
import { SmartPoolManager__factory } from '../../typechain/factories/SmartPoolManager__factory';

import { BFactory__factory } from '../../typechain/factories/BFactory__factory';
import { BFactory } from '../../typechain/BFactory';

import { RelayHub__factory } from '../../typechain/factories/RelayHub__factory';
import { RelayHub } from '../../typechain/RelayHub';

import { Token__factory } from '../../typechain/factories/Token__factory';
import { Token } from '../../typechain/Token';

import { WETH9__factory } from '../../typechain/factories/WETH9__factory'
import { WETH9 } from '../../typechain/WETH9';

/*const RELAY_HUB_CONFIG = {
  gasOverhead: 35965,
  postOverhead: 13950,
  gasReserve: 100000,
  maxWorkerCount: 10,
  minimumStake: 1e18.toString(),
  minimumUnstakeDelay: 1000,
  maximumRecipientDeposit: 2e18.toString()
}*/

export interface EnvContracts {
    bfactory: BFactory,
 // relayHub: RelayHub,
    weth: WETH9,
    tokA: Token,
    tokB: Token,
    tokC: Token
}

//export interface EnvLibs {
//    [id: string]: any
//}

export type EnvLibs = any;

export async function deployLibs(signer: Ethers.Signer) {

    if(bre.network.name === 'kovan') {
      console.log('kovan network detected');

      return {
        "__$4c38f6d953980cddd3b3b35f19465719a4$__": '0x244dA0A98e10Ac07112E9c87F82c62a84Ea1C460',
        "__$d299c529ae9894de884ff0b1c314d5e4d5$__": '0x2D556F6408e4f46Ce9181ce6Efb625fA132db223',
        "__$3090edb928940b408c0d9b35a986dbcddb$__": '0x2b4722F64E3b6d880bd618e162CEa6A41995D60F',
      };

      /*return {
      "__$4c38f6d953980cddd3b3b35f19465719a4$__": '0x8DBB8C9bFEb7689f16772c85136993cDA0c05eA4',
      "__$d299c529ae9894de884ff0b1c314d5e4d5$__": '0xFd069b1d2daC3d1C277BeFa8E51Aad77D9f9167B',
      "__$3090edb928940b408c0d9b35a986dbcddb$__": '0x0fd81EFddb4f8b2948B164145FbbcC8084136DcB',
      }*/
    }

    const rightsManager = await new RightsManager__factory(signer).deploy();
    await rightsManager.deployed();
    const smartPoolManager = await new SmartPoolManager__factory(signer).deploy();
    await smartPoolManager.deployed();
  
    // safe math does not have an ABI for some reason...?
    const safeMath = await (await ethers.getContractFactory("BalancerSafeMath")).deploy();
  
    await safeMath.deployed();
  
    // below changed to match with treasury factory generated linking in order to run tests
    return {
      "__$3973e80ae02d5389bae71cf7158dc6a2fe$__": smartPoolManager.address,
      "__$a50f5b38fcbdb2019850b089c75525c263$__": rightsManager.address,
      "__$2dd58cb41e28e69618f8365a6abab0efa0$__": safeMath.address,
    };
}

export async function deployEnv(signer: Ethers.Signer): Promise<[ EnvContracts, EnvLibs ]> {

    const contracts: EnvContracts = (<EnvContracts>{});

    // deploy libs
    const libs = await deployLibs(signer);

    // deploy bfactory
    const bFactory = new BFactory__factory(signer);

    contracts.bfactory = await bFactory.deploy();

    /*
    // deploy GSN relayhub
    contracts.relayHub = await new RelayHub__factory(signer).deploy(
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
    */

    // deploy tokens
    contracts.weth = await new WETH9__factory(signer).deploy();
    await contracts.weth.deposit({
      value: ethers.utils.parseEther('1000')
    });

    const tokenFactory = new Token__factory(signer);

    contracts.tokA = await tokenFactory.deploy('Token A', 'TOKA', ethers.constants.MaxUint256);
    contracts.tokB = await tokenFactory.deploy('Token B', 'TOKB', ethers.constants.MaxUint256);
    contracts.tokC = await tokenFactory.deploy('Token C', 'TOKC', ethers.constants.MaxUint256);

    await contracts.tokC.deployed();

    return [ contracts, libs ];
}

if(module == require.main) {

    // convert flags to data
    (async () => {

        const signer = (await ethers.getSigners())[0];
        const [contracts, libs] = await deployEnv(signer);

        console.log('env deployed:', _.map(contracts, (v, n) => `${n}: ${v.address}` ));
    })();
}