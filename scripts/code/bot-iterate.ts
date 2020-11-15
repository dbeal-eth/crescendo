import _ from 'lodash';

import { BigNumber, ContractReceipt, ethers as Ethers } from "ethers";

import { ethers } from 'hardhat';

import { Crescendo } from '../../typechain/Crescendo';
import { TokenFactory } from '../../typechain/TokenFactory';
import { Token } from '../../typechain/Token';

//@ts-ignore
import CRESCENDO_DATA = require('../../artifacts/contracts/Crescendo.sol/Crescendo.json');

interface CrecTransferInfo {
    amt: BigNumber,
    toIdx: number
}

function parseCrecTransfer(n: BigNumber): CrecTransferInfo {
    return {
        amt: n.shl(64).shl(64),
        toIdx: n.shr(160).mask(0xffff).toNumber()
    }
}

const STARTING_WEIGHT = ethers.utils.parseEther('10');

export async function runBotExec(crec: Crescendo, token: Token, pairId: number, options: any = {}): Promise<ContractReceipt|null> {
    // get list of addresses still requiring transactions to send

    console.log('do stuff');

    const filter = token.filters.Approval(null, crec.address, null);

    const events = await token.queryFilter(filter);

    console.log('found events', events);

    const addrs = new Set<string>();
    for(const e of events) {
        if(!e.args)
            continue;
        
        // get the actual current approve value
        const val = await token.allowance(e.args[0], crec.address);

        const opId = await crec.calculateOpId(val);

        if(opId != pairId)
            continue;

        const valid = await crec.calculateApproveValue(token.address, opId, e.args[0]);
        console.log('found approve value', ethers.utils.formatEther(valid));

        //console.log(parseCrecTransfer(e.args[2]));

        if(e.args[1] == crec.address && !valid.isZero()) {
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

    const txn = await crec.exec(pairId, finalAddrs, {gasLimit: 400000 });

    console.log(txn.hash);

    const res = txn.wait();

    return res;
}

if(module == require.main) {

    // convert flags to data
    (async () => {

        const signer = (await ethers.getSigners())[0];

        const crecAddress = process.env.CREC!;
        const tokenAddress = process.env.TOKEN!;
        const pairId = parseInt(process.env.PAIR_ID!);

        const crec = new ethers.Contract(crecAddress, CRESCENDO_DATA.abi, signer) as unknown as Crescendo;

        const rcpt = await runBotExec(crec, TokenFactory.connect(tokenAddress, signer), pairId);

        if(rcpt) {
            console.log('txn status:', rcpt.status);
            console.log('gas used: ', rcpt.gasUsed.toNumber());
        }
        else {
            console.log('nothing found to transact');
        }
    })();
}