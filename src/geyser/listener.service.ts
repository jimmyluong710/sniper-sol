import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { ParsedTransactionWithMeta } from '@solana/web3.js';
import { CommitmentLevel, SubscribeRequest, txEncode } from '@triton-one/yellowstone-grpc';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { IDecodedTxn, PUMP_FUN_AMM_PROGRAM_ID, PumpFunAMMExchange } from './pumpswap.parser';
import { GEYSER_MESSAGE, GeyserSubscriber } from './subscriber';

const WSOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';

@Injectable()
export class GeyserSwapEventService implements OnModuleInit {
    private mapPotentialPool: Map<
        string,
        {
            maker: string;
            entryPrice: number;
            sol: number;
            mcapBuy: number;
            maxPrice: number;
            maxAt: Date;
            capturedAt: Date;
        }
    > = new Map();

    private mapCurrentPrices: Map<string, number> = new Map();

    private trackingPoolTxns: Map<string, { timestamp: number; type: 'buy' | 'sell'; volume: number }[]> = new Map();

    private trackingWhaleTxns: Map<
        string,
        Record<
            string,
            {
                timestamp: Date;
                type: 'buy' | 'sell';
                amountSol: number;
                amountToken: number;
                lastTokenBalance?: number;
            }[]
        >
    > = new Map();

    private trackingFistTop10: Map<
        string,
        Record<
            string,
            {
                timestamp: Date;
                type?: 'buy' | 'sell';
                amountSol?: number;
                amountToken?: number;
                lastTokenBalance?: number;
            }[]
        >
    > = new Map();

    private newlyPoolsMap: Map<string, number> = new Map();

    private mappingPoolToTokenMap: Map<string, string> = new Map();

    private trackingHoldersMap: Map<
        string,
        {
            timestamp: Date;
            mcap: number;
            top10: number;
            holders: number;
        }[]
    > = new Map();

    private smlBoughtMap: Map<
        string,
        {
            entryPrice: number;
            mcapBuy: number;
            maxPrice: number;
        }
    > = new Map();

    constructor(private readonly eventEmitter: EventEmitter2) {}

    async onModuleInit() {
        setInterval(async () => {
            const holders = Array.from(this.newlyPoolsMap, ([pair, value]) => ({
                pair,
                value,
            }));
            await Promise.all(
                holders.map(async ({ pair, value }) => {
                    if (!this.newlyPoolsMap.get(pair)) return;
                    const token = this.mappingPoolToTokenMap.get(pair);

                    let holdersMetric;
                    try {
                        holdersMetric = await this._fetchHolders(token, pair);
                        delete holdersMetric.top10Holders;
                    } catch (e) {}
                    if (!holdersMetric) return;

                    const volumeMetrics = this._calculateMetrics(pair);
                    const whales = this.trackingWhaleTxns.get(pair);
                    const firstTop10 = this.trackingFistTop10.get(pair);
                    const mcap = Math.floor((this.mapCurrentPrices.get(pair) * 10 ** 9 * 176) / 1000);
                    const currMetric = {
                        timestamp: new Date(),
                        mcap,
                        whalesTxns: [
                            ...Object.entries(whales).map(([address, txns]) => {
                                const newTxns = txns.map((txn) => ({ ...txn }));
                                if (txns[0].lastTokenBalance < 1) delete this.trackingWhaleTxns.get(pair)[address];

                                return {
                                    address,
                                    txns: newTxns,
                                };
                            }),
                        ],
                        firstTop10Txns: [
                            ...Object.entries(firstTop10)?.map(([address, txns]) => {
                                const newTxns = txns.map((txn) => ({ ...txn }));
                                if (txns[0].lastTokenBalance < 1) delete this.trackingFistTop10.get(pair)[address];

                                return {
                                    address,
                                    txns: newTxns,
                                };
                            }),
                        ],
                        ...holdersMetric,
                        ...volumeMetrics,
                    };
                    const newVal = this.trackingHoldersMap.get(pair) ? [...this.trackingHoldersMap.get(pair), currMetric] : [currMetric];
                    this.trackingHoldersMap.set(pair, newVal);

                    const data = this.trackingHoldersMap.get(pair);
                    if (data && data.length > 0) {
                        const filePath = path.join(__dirname, `${pair}.json`);
                        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
                    } else {
                        console.log('No data to save for', pair);
                    }
                    if (mcap < 30 || data.length > 100) {
                        this.trackingHoldersMap.delete(pair);
                        this.trackingWhaleTxns.delete(pair);
                        this.trackingFistTop10.delete(pair);
                        this.trackingPoolTxns.delete(pair);
                        this.newlyPoolsMap.delete(pair);
                    }
                }),
            );
        }, 15 * 1000);
    }

    async startSubscribing(commitment: CommitmentLevel): Promise<void> {
        const request: SubscribeRequest = {
            accounts: {},
            slots: {},
            transactions: {
                client: {
                    vote: false,
                    failed: false,
                    accountInclude: [PUMP_FUN_AMM_PROGRAM_ID],
                    accountExclude: [],
                    accountRequired: [],
                },
            },
            transactionsStatus: {},
            entry: {},
            blocks: {},
            blocksMeta: {},
            commitment,
            accountsDataSlice: [],
            ping: undefined,
        };

        await new GeyserSubscriber(this.eventEmitter).startListening(request);
    }

    @OnEvent(GEYSER_MESSAGE)
    async onUpdateMessage(payload: any) {
        const txn = payload.message;
        if (!txn?.transaction) {
            return;
        }

        const slot: number = txn.slot;
        const encodedTxn = txEncode.encode(txn.transaction, txEncode.encoding.JsonParsed, 255, true);
        const parsedTxn: ParsedTransactionWithMeta = {
            ...encodedTxn,
            slot,
        } as any;

        const detectedTxns = new PumpFunAMMExchange().parseTransaction(parsedTxn);
        this._detectPrice(detectedTxns);

        // TODO
        // this._decideToBuy(detectedTxn);
    }

    private _detectPrice(decodedTxns: IDecodedTxn[]) {
        decodedTxns.map((item) => {
            const baseMint = item.inMint == WSOL_MINT_ADDRESS ? item.outMint : item.inMint;
            if (item.type == 'add' && item.isMigratedFromPump) {
                console.log('migrated', item.pair);
                this.newlyPoolsMap.set(item.pair, 1);
                this.trackingWhaleTxns.set(item.pair, {});
                this._fetchHolders(baseMint, item.pair).then((data) => {
                    const temp = {};
                    const timestamp = new Date();
                    Object.entries(data.top10Holders).map(([addr, balance]) => {
                        temp[addr] = [{ timestamp, lastTokenBalance: Number(balance) }];
                    });

                    this.trackingFistTop10.set(item.pair, temp);
                });
            }

            if (item.type != 'swap') return;
            if (!this.newlyPoolsMap.has(item.pair)) return;

            const lastInBalance = item.tokenVaultIn.postUiAmount;
            const lastOutBalance = item.tokenVaultOut.postUiAmount;

            const txnPrice = item.inMint == WSOL_MINT_ADDRESS ? lastInBalance / lastOutBalance : lastOutBalance / lastInBalance;

            const prevPrice = this.mapCurrentPrices.get(item.pair);
            this._updateMaxPrice(item.pair, txnPrice, prevPrice);

            this.mapCurrentPrices.set(item.pair, txnPrice);

            const type = item.inMint == WSOL_MINT_ADDRESS ? 'buy' : 'sell';
            const amountSol = item.inMint == WSOL_MINT_ADDRESS ? item.inUiAmount : item.outUiAmount;
            const amountToken = item.inMint == WSOL_MINT_ADDRESS ? item.outUiAmount : item.inUiAmount;

            if (!this.mappingPoolToTokenMap.has(item.pair)) this.mappingPoolToTokenMap.set(item.pair, baseMint);

            this._trackPoolTxns(item, type, amountSol);
            this._trackWhaleTxns(item, type, amountSol, amountToken);
        });
    }

    private _trackPoolTxns(txn: IDecodedTxn, type: 'buy' | 'sell', volume: number) {
        if (!this.newlyPoolsMap.has(txn.pair)) return;
        if (!this.trackingPoolTxns.has(txn.pair)) {
            this.trackingPoolTxns.set(txn.pair, []);
        }

        const now = new Date().getTime();
        this.trackingPoolTxns.get(txn.pair).push({ timestamp: now, type, volume });

        const oneMinuteAgo = now - 60 * 1000;
        this.trackingPoolTxns.set(
            txn.pair,
            this.trackingPoolTxns.get(txn.pair).filter((item) => item.timestamp > oneMinuteAgo),
        );
    }

    private _trackWhaleTxns(txn: IDecodedTxn, type: 'buy' | 'sell', amountSol: number, amountToken: number) {
        if (!this.newlyPoolsMap.has(txn.pair)) return;

        const date = new Date();

        if (this.trackingFistTop10.get(txn.pair)?.[txn.signer]) {
            this.trackingFistTop10.get(txn.pair)[txn.signer].push({
                timestamp: date,
                type,
                amountSol,
                amountToken,
            });
        }

        if (this.trackingWhaleTxns.get(txn.pair)[txn.signer]) {
            this.trackingWhaleTxns.get(txn.pair)[txn.signer].push({
                timestamp: date,
                type,
                amountSol,
                amountToken,
            });
        } else if (amountSol > 3 && type == 'buy') {
            this.trackingWhaleTxns.get(txn.pair)[txn.signer] = [
                {
                    timestamp: date,
                    type,
                    amountSol: amountSol,
                    amountToken,
                },
            ];
        }
    }

    private _updateMaxPrice(pair: string, txnPrice: number, prevPrice: number) {
        if (txnPrice < prevPrice || !this.mapPotentialPool.has(pair)) return;

        const offsetPrice = txnPrice - prevPrice;

        // sandwich, since the offset increased over 20%
        if (offsetPrice / prevPrice > 0.2) return;

        if (txnPrice > this.mapPotentialPool.get(pair).maxPrice) {
            const pool = this.mapPotentialPool.get(pair);
            this.mapPotentialPool.set(pair, {
                ...pool,
                maxPrice: txnPrice,
                maxAt: new Date(),
            });
        }

        if (this.smlBoughtMap.has(pair) && txnPrice > this.smlBoughtMap.get(pair).maxPrice) {
            const pool = this.smlBoughtMap.get(pair);
            this.smlBoughtMap.set(pair, {
                ...pool,
                maxPrice: txnPrice,
            });
        }
    }

    private _calculateMetrics(pair: string) {
        const now = Date.now();
        const timeframe = now - 15 * 1000;

        const transactions = this.trackingPoolTxns.get(pair);
        const recentTxns = transactions.filter((txn) => txn.timestamp > timeframe);

        const buys = recentTxns.filter((txn) => txn.type === 'buy');
        const sells = recentTxns.filter((txn) => txn.type === 'sell');

        return {
            buys: buys.length,
            sells: sells.length,
            buyVolume: buys.reduce((sum, txn) => sum + txn.volume, 0),
            sellVolume: sells.reduce((sum, txn) => sum + txn.volume, 0),
        };
    }

    private async _fetchHolders(mint: string, pair: string) {
        let data = '';

        let config = {
            method: 'get',
            maxBodyLength: Infinity,
            url: `https://api.dex3.fi/dev/redis?key=holders:{${mint}}&type=sorted`,
            headers: {
                'x-api-key': 'luQFwXgd1N1q6Jf89F1jemCSlgd1N1qm52copMw',
                Cookie: 'AWSALB=IzaA+7VGeuI9gHYlo0MtBBMxHAN+OrEkNW1pRXg18DJZNKk9N8F8xkglLOdnNrdu4fTvCQkMH4I0Qgpnyl7ImSa+4noE0BYYf7pPrc4DpBS07sws6svNmLNEdRpIBJqVYuzESyTA+bQsxAPfEgjpHRhRg0OTjPWXpgKEnSTVPPZCQ8fOIGz194vX6L2KKg==; AWSALBCORS=IzaA+7VGeuI9gHYlo0MtBBMxHAN+OrEkNW1pRXg18DJZNKk9N8F8xkglLOdnNrdu4fTvCQkMH4I0Qgpnyl7ImSa+4noE0BYYf7pPrc4DpBS07sws6svNmLNEdRpIBJqVYuzESyTA+bQsxAPfEgjpHRhRg0OTjPWXpgKEnSTVPPZCQ8fOIGz194vX6L2KKg==; AWSALB=OduBoIDpxvohoh2agc1guIJ54hTXb5c358LzRY9uiECeFjnqtSKYmA71XB7e1gK8GJZPZVgE5ug4zEygPjiUDL9fURz7wm05eBzI4wDy7i4TRWJZ8urz79gTjfuw; AWSALBCORS=OduBoIDpxvohoh2agc1guIJ54hTXb5c358LzRY9uiECeFjnqtSKYmA71XB7e1gK8GJZPZVgE5ug4zEygPjiUDL9fURz7wm05eBzI4wDy7i4TRWJZ8urz79gTjfuw',
            },
            data: data,
        };

        const resp = await axios.request(config);
        const holders = resp.data;
        if (!holders) {
            return null;
        }

        Object.values(this.trackingWhaleTxns.get(pair)).forEach((val) => {
            val[0].lastTokenBalance = 0;
        });

        if (this.trackingFistTop10.get(pair))
            Object.values(this.trackingFistTop10.get(pair)).forEach((val) => {
                val[0].lastTokenBalance = 0;
            });

        const top10Holders = {};
        const top10 = Object.entries(holders)
            .filter(([balance, addr]) => {
                if (addr == pair) return false;

                if (this.trackingWhaleTxns.get(pair)[addr as any]) {
                    this.trackingWhaleTxns.get(pair)[addr as any][0].lastTokenBalance = Number(balance);
                }

                if (this.trackingFistTop10.get(pair)?.[addr as any]) {
                    this.trackingFistTop10.get(pair)[addr as any][0].lastTokenBalance = Number(balance);
                }

                return true;
            })
            .slice(-10)
            .reduce((total, [balance, addr]) => {
                top10Holders[addr as any] = balance;
                return (total += Number(balance));
            }, 0);

        return {
            top10: Math.floor((top10 / 10 ** 9) * 100),
            top10Holders,
            holders: Object.keys(holders).length,
        };
    }
}
