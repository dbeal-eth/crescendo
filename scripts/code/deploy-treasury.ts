import _ from 'lodash';

import { BigNumber, ethers as Ethers } from "ethers";

import { ethers } from 'hardhat';

import { deployLibs, EnvLibs } from './deploy-env';

import { CRPTreasuryFactory__factory } from '../../typechain/factories/CRPTreasuryFactory__factory';
import { Treasury } from '../../typechain/Treasury';
import { Treasury__factory } from '../../typechain/factories/Treasury__factory';

import { IERC20 } from '../../typechain/IERC20';
import { Token__factory } from '../../typechain/factories/Token__factory';
// something is wrong with the generated code for ierc20factory, tsc does not like
//import { Ierc20Factory } from '../typechain/Ierc20Factory'
//const Ierc20Factory = require('../typechain/Ierc20Factory');

const STARTING_WEIGHT = ethers.utils.parseEther('10');

export async function deployTreasuryWithPool(signer: Ethers.Signer, libs: EnvLibs, bfactoryAddress: string, tokens: [string, BigNumber][], options: any = {}): Promise<Treasury> {

    const treasury = await deployTreasury(signer, libs, bfactoryAddress, tokens, options);

    for(const token of tokens) {
        // typescript has some sort of issue with the generated code for IERC20
        const ctrct = await ethers.getContractAt('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20', token[0], signer);
        
        const txn = await ctrct.approve(treasury.address, ethers.constants.MaxUint256) as IERC20;

        await txn.wait(1);
    }

    let txn = await treasury["createPool(uint256)"](ethers.utils.parseEther((10000).toString()));

    await txn.wait(1);

    return treasury;
}

export async function deployTreasuryWithPoolNoFactory(signer: Ethers.Signer, libs: EnvLibs, bfactoryAddress: string, tokens: [string, BigNumber][], options: any = {}): Promise<Treasury> {

    //await new Promise((resolve, reject) => { setTimeout(reject, 100000) })

    const treasury = await new Treasury__factory(libs, signer).deploy(bfactoryAddress, {
        poolTokenSymbol: options.poolTokenSymbol || 'TREAS',
        poolTokenName: options.poolTokenName || 'Treasury',
        constituentTokens: _.map(tokens, 0),
        tokenBalances: _.map(tokens, 1),
        tokenWeights: _.map(tokens, (_, i) => i == 0 ? STARTING_WEIGHT : STARTING_WEIGHT.div(2)),
        swapFee: options.swapFee || ethers.utils.parseEther('0.000001'),
    }, {
        canPauseSwapping: true,
        canChangeSwapFee: false,
        canChangeWeights: true,
        canAddRemoveTokens: true,
        canWhitelistLPs: true,
        canChangeCap: true,
    });

    for(const token of tokens) {
        // typescript has some sort of issue with the generated code for IERC20
        const ctrct = await ethers.getContractAt('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20', token[0], signer);
        
        const txn = await ctrct.approve(treasury.address, ethers.constants.MaxUint256);
        await txn.wait(1);
    }

    let txn = await treasury["createPool(uint256)"](ethers.utils.parseEther((10000).toString()));
    await txn.wait(1);

    return treasury;
}

export async function deployTreasury(signer: Ethers.Signer, libs: EnvLibs, bfactoryAddress: string, tokens: [string, BigNumber][], options: any = {}): Promise<Treasury> {

    // deploy treasury factory
    const factory = await new CRPTreasuryFactory__factory(libs, signer).deploy();

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

    const treas = new Treasury__factory(libs, signer).attach(addr);

    return treas;
}

export async function setTrustedForwarder(treas: Treasury, forwarder: string) {
    return await treas.setTrustedForwarder(forwarder);
}

export async function setRelayHub(treas: Treasury, rh: string) {
    return await treas.setRelayHub(rh, ethers.utils.parseEther('0.1'));
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

        const tokens: [string, BigNumber][] = [];

        for(const p of process.env.TOKENS!.split(',')) {
            const parts = p.split('=');

            const tokenContract = Token__factory.connect(parts[0], signer);

            const decimals = await tokenContract.decimals();

            tokens.push([parts[0], ethers.utils.parseEther(parts[1]).mul(BigNumber.from(10).pow(decimals)).div(BigNumber.from(10).pow(18))]);
        }

        if(tokens.length < 2) {
            console.error('at least 2 tokens must be supplied');
            return;
        }

        let treas: Treasury;
        if(process.env.TREASURY) {
            treas = Treasury__factory.connect(process.env.TREASURY, signer);
        }
        else {
            const libs = await deployLibs(signer);
    
            treas = await deployTreasuryWithPoolNoFactory(
                signer,
                libs,
                bfactoryAddress,
                tokens
            );
            
            console.log(treas.address);
            //console.log('treasury deployed:', treas.address);
        }

        if(process.env.FORWARDER) {
            const forwarder = await setTrustedForwarder(treas, process.env.FORWARDER);
            console.log('set forwarder', (await forwarder.wait()).transactionHash);
        }

        if(process.env.RELAY_HUB) {
            const relayHub = await setRelayHub(treas, process.env.RELAY_HUB);
            console.log('set relay hub', (await relayHub.wait()).transactionHash);
        }
    })();
}