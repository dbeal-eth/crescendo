import _ from 'lodash';

import { BigNumber, ethers as Ethers } from "ethers";

import { ethers } from '@nomiclabs/buidler';

import { deployLibs, EnvLibs } from './deploy-env';

import { CrpTreasuryFactoryFactory } from '../typechain/CrpTreasuryFactoryFactory';
import { Treasury } from '../typechain/Treasury';
import { TreasuryFactory } from '../typechain/TreasuryFactory';

import { Ierc20 } from '../typechain/Ierc20';
// something is wrong with the generated code for ierc20factory, tsc does not like
//import { Ierc20Factory } from '../typechain/Ierc20Factory'
//const Ierc20Factory = require('../typechain/Ierc20Factory');

const STARTING_WEIGHT = ethers.utils.parseEther('10');

export async function deployTreasuryWithPool(signer: Ethers.Signer, libs: EnvLibs, bfactoryAddress: string, tokens: [string, BigNumber][], options: any = {}): Promise<Treasury> {

    const treasury = await deployTreasury(signer, libs, bfactoryAddress, tokens, options);

    for(const token of tokens) {
        // typescript has some sort of issue with the generated code for IERC20
        const ctrct = (await (await ethers.getContractFactory('IERC20', signer)).attach(token[0]));
        
        const txn = await ctrct.approve(treasury.address, ethers.constants.MaxUint256) as Ierc20;

        await txn.wait(1);
    }

    let txn = await treasury["createPool(uint256)"](ethers.utils.parseEther((10000).toString()));

    await txn.wait(1);

    return treasury;
}

export async function deployTreasury(signer: Ethers.Signer, libs: EnvLibs, bfactoryAddress: string, tokens: [string, BigNumber][], options: any = {}): Promise<Treasury> {

    // deploy treasury factory
    const factory = await new CrpTreasuryFactoryFactory(libs, signer).deploy();

    await factory.deployed();

    const tokenWeights = _.map(tokens, (v, i) => {
        if(i == 0)
            return STARTING_WEIGHT;
        else
            return STARTING_WEIGHT.div(2);
    });

    // tell the factory to deploy a treasury itself
    let txn = await factory.newTreasury(bfactoryAddress, {
      poolTokenSymbol: options.poolTokenSymbol || 'TREAS',
      poolTokenName: options.poolTokenName || 'Treasury',
      constituentTokens: _.map(tokens, 0),
      tokenBalances: _.map(tokens, 1),
      tokenWeights: tokenWeights,
      swapFee: options.swapFee || ethers.utils.parseEther('0.000001'),
    }, {
      canPauseSwapping: true,
      canChangeSwapFee: false,
      canChangeWeights: true,
      canAddRemoveTokens: true,
      canWhitelistLPs: true,
      canChangeCap: true,
    });

    const rcpt = await txn.wait(1); // wait extra txns here because for some reason in test env contract does not deploy properly

    const addr = _.find(rcpt.events, e => e.event === 'LogNewTreasury')!.args![1];

    const treas = new TreasuryFactory(libs, signer).attach(addr);

    return treas;
}


if(module == require.main) {

    // convert flags to data
    (async () => {

        const signer = (await ethers.getSigners())[0];

        const bfactoryAddress = process.env.BFACTORY;

        if(!bfactoryAddress) {
            console.error('BFactory address not supplied');
            return;
        }
        
        const tokens: [string, BigNumber][] = process.env.TOKENS!.split(',').map(p => {
            const parts = p.split('=')

            return [parts[0], ethers.utils.parseEther(parts[1])];
        });

        if(tokens.length < 2) {
            console.error('at least 2 tokens must be supplied');
            return;
        }

        const libs = await deployLibs(signer);
    
        const treas = await deployTreasuryWithPool(
            signer,
            libs,
            bfactoryAddress,
            tokens
        );
        
        console.log('treasury deployed:', treas.address);
    })();
}