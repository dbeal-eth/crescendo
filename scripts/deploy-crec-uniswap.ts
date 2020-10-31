import _ from 'lodash';

import { BigNumber, ethers as Ethers } from "ethers";

import { ethers } from 'hardhat';

import { Treasury } from '../typechain/Treasury';
import { CrecUniswap } from '../typechain/CrecUniswap';
import { CrecUniswapFactory } from '../typechain/CrecUniswapFactory';
import { TreasuryFactory } from '../typechain/TreasuryFactory';

const STARTING_WEIGHT = ethers.utils.parseEther('10');

export async function deployCrecUniswap(signer: Ethers.Signer, treasury: Treasury, options: any = {}): Promise<CrecUniswap> {

    // get balance of treasury for weth
    let targetTreasuryBalance = options.targetTreasuryBalance;

    if(!targetTreasuryBalance) {
        // assume the target is whatever is in the inherited treasury
        targetTreasuryBalance = await treasury.getTreasuryBalance();
    }

    console.log('target traesury balance', targetTreasuryBalance);

    const crecUniswap = await new CrecUniswapFactory(signer).deploy(treasury.address, options.targetInterval || ethers.BigNumber.from(600), targetTreasuryBalance);

    await crecUniswap.deployed();

    const txn = await treasury.setController(crecUniswap.address);
    await txn.wait(1);

    return crecUniswap;
}


if(module == require.main) {

    // convert flags to data
    (async () => {

        const signer = (await ethers.getSigners())[0];

        const treasuryAddress = process.env.TREASURY!;

        if(!treasuryAddress) {
            console.error('Treasury address not specified');
            return;
        }

        const crecUniswap = await deployCrecUniswap(signer, TreasuryFactory.connect(treasuryAddress, signer));

        console.log('deployed crescendo uniswap', crecUniswap.address);
    })();
}