import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { ParsedTransactionWithMeta } from '@solana/web3.js';
import {
  CommitmentLevel,
  SubscribeRequest,
  txEncode,
} from '@triton-one/yellowstone-grpc';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import {
  IDecodedTxn,
  PUMP_FUN_AMM_PROGRAM_ID,
  PumpFunAMMExchange,
} from './pumpswap.parser';
import { GEYSER_MESSAGE, GeyserSubscriber } from './subscriber';

const WSOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';

@Injectable()
export class GeyserSwapEventService implements OnModuleInit {
  private logger = new Logger(GeyserSwapEventService.name);

  private mapBoughtPools: Map<string, number> = new Map();

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

  private trackingPoolTxns: Map<
    string,
    { timestamp: number; type: 'buy' | 'sell'; volume: number }[]
  > = new Map();

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

  private newlyPoolsMap: Map<string, number> = new Map();

  private mappingPoolToTokenMap: Map<string, string> = new Map();

  private trackingHoldersMap: Map<
    string,
    {
      timestamp: Date;
      mcap: number;
      holdOver5M: number;
      holdOver10M: number;
      holdOver20M: number;
      holdOver30M: number;
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

  private closedPool = [];

  private slotMap = new Map();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async onModuleInit() {
    // setInterval(() => {
    //   // console.debug(
    //   //   `=========================== Size: ${this.mapPotentialPool.size} ======================`,
    //   // );
    //   for (const [key, value] of this.mapPotentialPool.entries()) {
    //     const metrics = this._calculateMetrics(key);
    //     const win = parseFloat((value.maxPrice / value.entryPrice).toFixed(2));
    //     const currentPrice = this.mapCurrentPrices.get(key);
    //     const currentPnl = parseFloat(
    //       (currentPrice / value.entryPrice).toFixed(2),
    //     );
    //     if (metrics.buys + metrics.sells > 53 && !this.smlBoughtMap.has(key)) {
    //       this.smlBoughtMap.set(key, {
    //         entryPrice: currentPrice,
    //         mcapBuy: Number((currentPrice * 10 ** 9 * 140).toFixed(2)),
    //         maxPrice: currentPrice,
    //       });
    //     }
    //     const durationWin =
    //       (value.maxAt.getTime() - value.capturedAt.getTime()) / 1000 / 60;
    //     // console.debug(
    //     //   `${key} - ${value.sol.toFixed(2)}sol - ${win} - ${currentPnl} - ${durationWin.toFixed(2)}m`,
    //     // );
    //     if (metrics.buys == 0 && metrics.sells == 0) {
    //       this.closedPool.push({
    //         pair: key,
    //         sol: value.sol,
    //         maxPnl: win,
    //         closedPnl: currentPnl,
    //         durationWin,
    //       });
    //       this.mapPotentialPool.delete(key);
    //       this.mapCurrentPrices.delete(key);
    //       this.trackingPoolTxns.delete(key);
    //       this.newlyPoolsMap.delete(key);
    //     }
    //   }
    //   // console.debug(
    //   //   `=========================== Closed Pool: ${this.closedPool.length} ======================`,
    //   // );
    //   // this.closedPool.map((item) => {
    //   //   console.debug(
    //   //     `${item.pair} - ${item.sol}sol - ${item.maxPnl} - ${item.closedPnl} - ${item.durationWin}m`,
    //   //   );
    //   // });
    //   // console.debug(
    //   //   `=========================== Sml buys: ${this.smlBoughtMap.size} ======================`,
    //   // );
    //   // for (const [key, value] of this.smlBoughtMap.entries()) {
    //   //   console.debug(
    //   //     `${key} - ${(value.mcapBuy / 1000).toFixed(2)}k - ${Number((value.maxPrice / value.entryPrice).toFixed(2))}`,
    //   //   );
    //   // }
    //   // console.debug('\n\n');
    // }, 10 * 1000);
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
          } catch (e) {}
          if (!holdersMetric) return;

          const volumeMetrics = this._calculateMetrics(pair);
          const whales = this.trackingWhaleTxns.get(pair);
          const mcap = Math.floor(
            (this.mapCurrentPrices.get(pair) * 10 ** 9 * 176) / 1000,
          );
          const currMetric = {
            timestamp: new Date(),
            mcap,
            whalesTxns: [
              ...Object.entries(whales).map(([address, txns]) => {
                const newTxns = txns.map((txn) => ({ ...txn }));
                if (txns[0].lastTokenBalance < 1)
                  delete this.trackingWhaleTxns.get(pair)[address];

                return {
                  address,
                  txns: newTxns,
                };
              }),
            ],
            ...holdersMetric,
            ...volumeMetrics,
          };
          const newVal = this.trackingHoldersMap.get(pair)
            ? [...this.trackingHoldersMap.get(pair), currMetric]
            : [currMetric];
          this.trackingHoldersMap.set(pair, newVal);
          // const rate =
          //   (newVal[newVal.length - 1].mcap - newVal[newVal.length - 2]?.mcap) /
          //   newVal[newVal.length - 2]?.mcap;
          // if (mcap > 30 && mcap < 2000 && newVal.length > 1 && rate > 0.05)
          const data = this.trackingHoldersMap.get(pair);
          if (data && data.length > 0) {
            const filePath = path.join(__dirname, `${pair}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
          } else {
            console.log('No data to save for', pair);
          }
          if (mcap < 30) this.newlyPoolsMap.delete(pair);
        }),
      );
    }, 20 * 1000);
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
    const encodedTxn = txEncode.encode(
      txn.transaction,
      txEncode.encoding.JsonParsed,
      255,
      true,
    );
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
      if (item.type == 'add' && item.isMigratedFromPump) {
        console.log('migrated', item.pair);
        this.newlyPoolsMap.set(item.pair, 1);
        this.trackingWhaleTxns.set(item.pair, {});
      }

      if (item.type != 'swap') return;
      if (!this.newlyPoolsMap.has(item.pair)) return;
      if (item.inMint != WSOL_MINT_ADDRESS && item.outMint != WSOL_MINT_ADDRESS)
        return;

      const lastInBalance = item.tokenVaultIn.postUiAmount;
      const lastOutBalance = item.tokenVaultOut.postUiAmount;

      const txnPrice =
        item.inMint == WSOL_MINT_ADDRESS
          ? lastInBalance / lastOutBalance
          : lastOutBalance / lastInBalance;

      const prevPrice = this.mapCurrentPrices.get(item.pair);
      this._updateMaxPrice(item.pair, txnPrice, prevPrice);

      this.mapCurrentPrices.set(item.pair, txnPrice);

      const type = item.inMint == WSOL_MINT_ADDRESS ? 'buy' : 'sell';
      const amountSol =
        item.inMint == WSOL_MINT_ADDRESS ? item.inUiAmount : item.outUiAmount;
      const amountToken =
        item.inMint == WSOL_MINT_ADDRESS ? item.outUiAmount : item.inUiAmount;
      const baseMint =
        item.inMint == WSOL_MINT_ADDRESS ? item.outMint : item.inMint;

      if (!this.mappingPoolToTokenMap.has(item.pair))
        this.mappingPoolToTokenMap.set(item.pair, baseMint);

      this._trackPoolTxns(item, type, amountSol);
      this._trackWhaleTxns(item, type, amountSol, amountToken);

      // TODO: type buy
      // if (type == 'buy' && amountSol > 11) {
      //   // omit sandwich attack
      //   setTimeout(() => {
      //     if (!this.mapPotentialPool.has(item.pair)) {
      //       const offsetPrice = txnPrice - this.mapCurrentPrices.get(item.pair);

      //       // sandwich, since the offset is over 20%
      //       if (offsetPrice > 0 && offsetPrice / txnPrice > 0.1) return;

      //       const buyAt = new Date();
      //       const mcapBuy =
      //         this.mapCurrentPrices.get(item.pair) * 10 ** 9 * 140;

      //       // over 3M$
      //       if (mcapBuy / 1000 > 3000) return;
      //       this.mapPotentialPool.set(item.pair, {
      //         maker: item.signer,
      //         entryPrice: this.mapCurrentPrices.get(item.pair),
      //         sol: amountSol,
      //         mcapBuy,
      //         maxPrice: this.mapCurrentPrices.get(item.pair),
      //         maxAt: buyAt,
      //         capturedAt: buyAt,
      //       });
      //     }
      //   }, 2000);
      // }

      // if (type == 'sell' && amountSol > 21) {
      //   // omit sandwich attack
      //   setTimeout(() => {
      //     if (!this.mapPotentialPool.has(item.pair)) {
      //       const offsetPrice = this.mapCurrentPrices.get(item.pair) - txnPrice;

      //       // sandwich, since the offset is over 20%
      //       if (offsetPrice > 0 && offsetPrice / txnPrice > 0.1) return;

      //       const sellAt = new Date();
      //       const mcapBuy =
      //         this.mapCurrentPrices.get(item.pair) * 10 ** 9 * 140;
      //       this.mapPotentialPool.set(item.pair, {
      //         maker: item.signer,
      //         entryPrice: this.mapCurrentPrices.get(item.pair),
      //         sol: amountSol,
      //         mcapBuy,
      //         maxPrice: this.mapCurrentPrices.get(item.pair),
      //         maxAt: sellAt,
      //         capturedAt: sellAt,
      //       });
      //     }
      //   }, 3000);
      // }
    });
  }

  private _trackPoolTxns(
    txn: IDecodedTxn,
    type: 'buy' | 'sell',
    volume: number,
  ) {
    if (!this.trackingPoolTxns.has(txn.pair)) {
      this.trackingPoolTxns.set(txn.pair, []);
    }

    const now = new Date().getTime();
    this.trackingPoolTxns.get(txn.pair).push({ timestamp: now, type, volume });

    const oneMinuteAgo = now - 60 * 1000;
    this.trackingPoolTxns.set(
      txn.pair,
      this.trackingPoolTxns
        .get(txn.pair)
        .filter((item) => item.timestamp > oneMinuteAgo),
    );
  }

  private _trackWhaleTxns(
    txn: IDecodedTxn,
    type: 'buy' | 'sell',
    amountSol: number,
    amountToken: number,
  ) {
    if (!this.newlyPoolsMap.has(txn.pair)) return;

    const date = new Date();
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

    if (
      this.smlBoughtMap.has(pair) &&
      txnPrice > this.smlBoughtMap.get(pair).maxPrice
    ) {
      const pool = this.smlBoughtMap.get(pair);
      this.smlBoughtMap.set(pair, {
        ...pool,
        maxPrice: txnPrice,
      });
    }
  }

  private _calculateMetrics(pair: string) {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    const transactions = this.trackingPoolTxns.get(pair);
    const recentTxns = transactions.filter(
      (txn) => txn.timestamp > oneMinuteAgo,
    );

    const buys = recentTxns.filter((txn) => txn.type === 'buy');
    const sells = recentTxns.filter((txn) => txn.type === 'sell');

    return {
      buys: buys.length,
      sells: sells.length,
      buyVolume: buys.reduce((sum, txn) => sum + txn.volume, 0),
      sellVolume: sells.reduce((sum, txn) => sum + txn.volume, 0),
    };
  }

  private async _decideToBuy(detectedTxn: any[]) {
    if (
      detectedTxn[0]?.type == 'add' &&
      detectedTxn[0]?.isMigratedFromPump == true
    ) {
      this.logger.debug(
        `=========================== ADD LIQUIDITY, PAIR: ${detectedTxn[0].pair} ======================`,
      );
      const swap = detectedTxn[1];
      if (!swap || swap.inMint != WSOL_MINT_ADDRESS) return;

      if (this.mapBoughtPools.has(swap.pair)) {
        return;
      }

      this.mapBoughtPools.set(swap.pair, 1);

      if (swap.inUiAmount > 40 && swap.inUiAmount < 55) {
        setTimeout(() => this._buy(swap.pair), 4 * 1000);
      } else if (swap.inUiAmount > 55) {
        setTimeout(() => this._buy(swap.pair), 40 * 1000);
      }
    }
  }

  private async _buy(pair: string) {
    let data = JSON.stringify([
      {
        type: 'trading',
        side: 'buy',
        unit: 'amount',
        walletAddress: '6ZKTRyt8VF9PvE4gfsppvWroBbCdqvUUjTpn7sDYSyWa',
        poolId: pair,
        amount: 0.01,
        slippage: 20,
        priorityFee: 0.00001,
        tipAmount: 0,
      },
    ]);

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://api.dex3.ai/trades/buysell/v2',
      headers: {
        accept: 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'access-control-allow-origin': '*',
        'cache-control': 'no-cache',
        clienttimestamp: new Date().getTime().toString(),
        'content-type': 'application/json',
        origin: 'https://dex3.ai',
        pragma: 'no-cache',
        priority: 'u=1, i',
        referer: 'https://dex3.ai/',
        'sec-ch-ua':
          '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        Cookie:
          '_ga=GA1.1.790812821.1742801528; refreshToken=s%3AeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjEzMjAsImppZCI6IjRkNzMzZTY5LTFlYzctNDM5My05MGVhLTI1MWYwMzI5NGY1NyIsInJlZnJlc2hUb2tlbiI6dHJ1ZSwiaWF0IjoxNzQ1MjI5NjI3LCJleHAiOjE3NDY1MjU2Mjd9.JR_0DGIHjmeyjmaYnJfMSTcVlsJ1Ojg2_9dAVuYAI2g.Fw%2F7Jo1WI67Qj5qA%2F%2BUhzxOwNWlyHFqhrWuNSEOBDew; _ga_ME8GZB3L70=GS1.1.1745234193.54.1.1745234284.60.0.0; authorization=s%3ABearer%20eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjEzMjAsImppZCI6IjRkNzMzZTY5LTFlYzctNDM5My05MGVhLTI1MWYwMzI5NGY1NyIsImlhdCI6MTc0NTIzNDMwNiwiZXhwIjoxNzQ1MjM3OTA2fQ.yr1hrfhdt1AK8i6yLsdD6LVxlNd5FNuqjjOEFLeiLQ0.dWQTHKbX0lEpwIDred2S1JxCyFzGVrOptw6J8HtI%2FNQ; AWSALB=8/5+Sc5DrCXlyW5oWFlyPM3Vl4k/zpubpPwZWzsm4vOmAmGaC1/Mlcl6E1d2F0DC0wvbepMfgTk5k4v0JNniwI7rsgBXGrmy7wyXuTk3tprphNYSCLEGBMeod79FJpvept0lGA47xcL3Y7LXMUoUKQ4HLCPQRopS9EiwYZ3RJ/GPCZ0b5CsoVGXzfIonMw==; AWSALBCORS=8/5+Sc5DrCXlyW5oWFlyPM3Vl4k/zpubpPwZWzsm4vOmAmGaC1/Mlcl6E1d2F0DC0wvbepMfgTk5k4v0JNniwI7rsgBXGrmy7wyXuTk3tprphNYSCLEGBMeod79FJpvept0lGA47xcL3Y7LXMUoUKQ4HLCPQRopS9EiwYZ3RJ/GPCZ0b5CsoVGXzfIonMw==; AWSALB=fhASVLmeDWlslspx7bKD5mqvnpy4xivfhe+O6GOqXGRexqLeqm8By4Fqd1r4C0uoKlynLM+3BMUzJHdLNnTy8meUOgH0kUmrtOuSVkpDcbDSJNgCEQ4WBOTQk9bvqDLP4pi3bm6fGLJ3DOMsi7R80Vsb7kG755tZZXp7QnpuMB/Ot6ey5NoMbkuvUI86Vw==; AWSALBCORS=fhASVLmeDWlslspx7bKD5mqvnpy4xivfhe+O6GOqXGRexqLeqm8By4Fqd1r4C0uoKlynLM+3BMUzJHdLNnTy8meUOgH0kUmrtOuSVkpDcbDSJNgCEQ4WBOTQk9bvqDLP4pi3bm6fGLJ3DOMsi7R80Vsb7kG755tZZXp7QnpuMB/Ot6ey5NoMbkuvUI86Vw==; authorization=s%3ABearer%20eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjEzMjAsImppZCI6IjRkNzMzZTY5LTFlYzctNDM5My05MGVhLTI1MWYwMzI5NGY1NyIsImlhdCI6MTc0NTIzNDM3NywiZXhwIjoxNzQ1MjM3OTc3fQ.jzMHQyw5gtAATR3GybZTP1sUvnKt_R69Y_HeZ4s8jos.PQ5I10hw1M1fDk9I88meHxa5vH4lZvrPhMR2qTW4KbA',
      },
      data: data,
    };

    await axios
      .request(config)
      .then((response) => {
        this.logger.debug(
          '=========================== BOUGHT SUCCESSFULLY ======================',
        );
        this.logger.log(JSON.stringify(response.data));
      })
      .catch((error) => {
        console.log(error);
      });
  }

  private async _fetchHolders(mint: string, pair: string) {
    let data = '';

    let config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: `https://api.dex3.fi/dev/redis?key=holders:{${mint}}&type=sorted`,
      headers: {
        'x-api-key': 'luQFwXgd1N1q6Jf89F1jemCSlgd1N1qm52copMw',
        Cookie:
          'AWSALB=IzaA+7VGeuI9gHYlo0MtBBMxHAN+OrEkNW1pRXg18DJZNKk9N8F8xkglLOdnNrdu4fTvCQkMH4I0Qgpnyl7ImSa+4noE0BYYf7pPrc4DpBS07sws6svNmLNEdRpIBJqVYuzESyTA+bQsxAPfEgjpHRhRg0OTjPWXpgKEnSTVPPZCQ8fOIGz194vX6L2KKg==; AWSALBCORS=IzaA+7VGeuI9gHYlo0MtBBMxHAN+OrEkNW1pRXg18DJZNKk9N8F8xkglLOdnNrdu4fTvCQkMH4I0Qgpnyl7ImSa+4noE0BYYf7pPrc4DpBS07sws6svNmLNEdRpIBJqVYuzESyTA+bQsxAPfEgjpHRhRg0OTjPWXpgKEnSTVPPZCQ8fOIGz194vX6L2KKg==; AWSALB=OduBoIDpxvohoh2agc1guIJ54hTXb5c358LzRY9uiECeFjnqtSKYmA71XB7e1gK8GJZPZVgE5ug4zEygPjiUDL9fURz7wm05eBzI4wDy7i4TRWJZ8urz79gTjfuw; AWSALBCORS=OduBoIDpxvohoh2agc1guIJ54hTXb5c358LzRY9uiECeFjnqtSKYmA71XB7e1gK8GJZPZVgE5ug4zEygPjiUDL9fURz7wm05eBzI4wDy7i4TRWJZ8urz79gTjfuw',
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

    let holdOver5M = 0;
    let holdOver10M = 0;
    let holdOver20M = 0;
    let holdOver30M = 0;
    const top10Addresses = [];
    const top10 = Object.entries(holders)
      .filter(([balance, addr]) => {
        if (addr == pair) return false;

        const realBal = Number(balance) / 10 ** 6;
        if (realBal >= 5 && realBal < 10) holdOver5M += 1;
        if (realBal >= 10 && realBal < 20) holdOver10M += 1;
        if (realBal >= 20 && realBal < 30) holdOver20M += 1;
        if (realBal >= 30) holdOver30M += 1;

        if (this.trackingWhaleTxns.get(pair)[addr as any]) {
          this.trackingWhaleTxns.get(pair)[addr as any][0].lastTokenBalance =
            Number(balance);
        }

        return true;
      })
      .slice(-10)
      .reduce((total, [balance, addr]) => {
        top10Addresses.push({ address: addr, balance: Number(balance) });
        return (total += Number(balance));
      }, 0);

    return {
      holdOver5M,
      holdOver10M,
      holdOver20M,
      holdOver30M,
      top10: Math.floor((top10 / 10 ** 9) * 100),
      holders: Object.keys(holders).length,
    };
  }
}
