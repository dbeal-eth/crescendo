import _ from 'lodash';

import { BigNumber, ethers as Ethers } from "ethers";

import { ethers } from '@nomiclabs/buidler';

import { CrecUniswap } from '../typechain/CrecUniswap';
import { CrecUniswapFactory } from '../typechain/CrecUniswapFactory';

export async function addAuthorizedPair(signer: Ethers.Signer, crecUniswap: CrecUniswap, options: any = {}): Promise<ethers> {
    crecUniswap.addAuthorizedPair()
}


if(module == require.main) {

    // convert flags to data
    (async () => {

        const signer = (await ethers.getSigners())[0];

        const crecUniswapAddress = process.env.CREC_UNISWAP!;

        if(!crecUniswapAddress) {
            console.error('Crescendo Uniswap address not specified');
            return;
        }

        const crecUniswap = await addAuthorizedPair(signer, CrecUniswapFactory.connect(crecUniswapAddress, signer));

        console.log('deployed crescendo uniswap', crecUniswap.address);
    })();
}