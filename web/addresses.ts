import { ethers } from "ethers";

const ADDRESSES = {
    'local': {
        crecUniswap: '',
        crecTransfer: '0x78Aeff0658Fa67735fBF99Ce7CDB01Fe5D520259'
    },
    'kovan': {
        crecUniswap: '',
        crecTransfer: '0x3114c4611Cd06eCC640ca0642985BC2Be5Ebff33'
    }
}

export function getAddresses(network: ethers.providers.Network) {
    switch(network && network.chainId ? network.chainId : 0) {
        case 42:
            return ADDRESSES.kovan;
        default:
            return ADDRESSES.local;
    }
}