import _ from 'lodash';

import { BigNumber, ContractReceipt, ethers as Ethers } from "ethers";

import { ethers } from 'hardhat';

import { CrecTransfer } from '../typechain/CrecTransfer';
import { CrecTransferFactory } from '../typechain/CrecTransferFactory';
import { TokenFactory } from '../typechain/TokenFactory';
import { Token } from '../typechain/Token';

interface CrecTransferInfo {
    amt: BigNumber,
    toIdx: number
}

function parseCrecTransfer(n: BigNumber): CrecTransferInfo {
    return {
        amt: n.shl(64).shl(64),
        toIdx: n.shr(224).toNumber()
    }
}

const STARTING_WEIGHT = ethers.utils.parseEther('10');

export async function runBotExec(crec: CrecTransfer, token: Token, options: any = {}): Promise<ContractReceipt|null> {
    // get list of addresses still requiring transactions to send

    const filter = token.filters.Approval(null, crec.address, null);

    const events = await token.queryFilter(filter);

    console.log('found events', events);

    const addrs = new Set<string>();
    for(const e of events) {
        if(!e.args)
            continue;

        console.log(parseCrecTransfer(e.args[2]));

        if(e.args[1] == crec.address && parseCrecTransfer(e.args[2]).amt.gt(0)) {
            addrs.add(e.args[0]);
        }
        else {
            addrs.delete(e.args[0]);
        }
    }

    if(!addrs.size)
        return null;

    // TODO: should sort array by amounts
    console.log('processing addrs', addrs);

    const finalAddrs = Array.from(addrs);

    const txn = await crec.exec(token.address, finalAddrs);

    const res = txn.wait();

    return res;
}

if(module == require.main) {

    // convert flags to data
    (async () => {

        const signer = (await ethers.getSigners())[0];

        const crecAddress = process.env.CREC_TRANSFER!;
        const tokenAddress = process.env.TOKEN!;

        const rcpt = await runBotExec(CrecTransferFactory.connect(crecAddress, signer), TokenFactory.connect(tokenAddress, signer));

        if(rcpt) {
            console.log('txn status:', rcpt.status);
            console.log('gas used: ', rcpt.gasUsed.toNumber());
        }
        else {
            console.log('nothing found to transact');
        }
    })();
}