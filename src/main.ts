import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GeyserSwapEventService } from './geyser/listener.service';
import { CommitmentLevel } from '@triton-one/yellowstone-grpc';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const geyserService = app.get(GeyserSwapEventService);
  geyserService.startSubscribing(CommitmentLevel.CONFIRMED);
  await app.listen(3000);
}
bootstrap();


// RUNNING VER 1
// {
//   maker: 'AU2Zhh3zEV6uxCQntmVRHoX2wVDYdyGTeGD7wQ7vMEk9',
//   pair: 'FSNwx74WTW3iV5GATnmHmSEYY9WNWVds1H7yi2gZdmMZ',
//   sol: 22.465968861,
//   win: 1.54,
//   currentPnl: 0.7,
//   durationWin: 3.2641166666666668,
//   metrics: {
//     buys: 23,
//     sells: 15,
//     buyVolume: 11.944400038000001,
//     sellVolume: 9.921620143
//   }
// }
// {
//   maker: '4dDsxHTEaXMbzSRAcS8wcN6KQnFkgiiEfJ7av4J7qV1R',
//   pair: '7oFfdxSkLazHFBZz1MMbmZUyBvGQMvjmSijGB8HJcWp',
//   sol: 31.315407362,
//   win: 1.05,
//   currentPnl: 0.76,
//   durationWin: 0.9335,
//   metrics: {
//     buys: 8,
//     sells: 10,
//     buyVolume: 15.006238816,
//     sellVolume: 15.517248856000002
//   }
// }
// {
//   maker: '4vJfp62jEzcYFnQ11oBJDgj6ZFrdEwcBBpoadNTpEWys',
//   pair: 'Hc9rfTaQaKQLakWVHa9A7yUVFSUQaT1pveXVb42DFF8J',
//   sol: 22.615312662,
//   win: 2.19,
//   currentPnl: 1.12,
//   durationWin: 32.21423333333333,
//   metrics: {
//     buys: 30,
//     sells: 17,
//     buyVolume: 16.968175574000004,
//     sellVolume: 13.508047283
//   }
// }
// {
//   maker: 'j1oAbxxiDUWvoHxEDhWE7THLjEkDQW2cSHYn2vttxTF',
//   pair: '4bLcvqxuLia8cFKeMKPXx31iCoty9KbU7bWYYNfCMsSV',
//   sol: 22.946719477,
//   win: 1.04,
//   currentPnl: 0.95,
//   durationWin: 5.063433333333333,
//   metrics: {
//     buys: 13,
//     sells: 1,
//     buyVolume: 3.2141755080000003,
//     sellVolume: 4.693577071
//   }
// }
// {
//   maker: 'DrLmurvD2BuNLUyLfzSys6V53nuLQtqPNzvKHHwbHLN3',
//   pair: '4w2cysotX6czaUGmmWg13hDpY4QEMG2CzeKYEQyK9Ama',
//   sol: 24.73765586,
//   win: 1.28,
//   currentPnl: 1.01,
//   durationWin: 20.142166666666665,
//   metrics: {
//     buys: 24,
//     sells: 61,
//     buyVolume: 67.98687816699999,
//     sellVolume: 53.80643120600001
//   }
// }
// {
//   maker: 'FGvj3vjDE4jdetCnsKtkUqCb95sKY11b9PoBMKwFprPH',
//   pair: '8TAq3NqDTaL8v6NSGP2V36dJwftVKNb62jA6MZ7ibAsa',
//   sol: 22.4886375,
//   win: 1.19,
//   currentPnl: 0.97,
//   durationWin: 45.33575,
//   metrics: {
//     buys: 9,
//     sells: 6,
//     buyVolume: 2.350016916,
//     sellVolume: 8.552782126999999
//   }
// }
// {
//   maker: 'Hyoi3ggtU2JpcTLsou98f2pCjqBFRRo7tfDbfXDbBSzu',
//   pair: 'D6Rgz1JG2syjsTXGaSAZ39cLffWL4TfabEAAnJHGRrZC',
//   sol: 55.405206234,
//   win: 1.06,
//   currentPnl: 0.94,
//   durationWin: 47.86713333333333,
//   metrics: {
//     buys: 18,
//     sells: 7,
//     buyVolume: 14.202934444000002,
//     sellVolume: 15.700295349000001
//   }
// }
// {
//   maker: '34caUhqLdLknMSGJqMYqh8DgkaUdNJwqTVPqiEPgRj4u',
//   pair: '5nEVU6zYUb8oNwB6RNNHQBG58bzxzcroRdXbTGJrD6pT',
//   sol: 24.737655859,
//   win: 3.58,
//   currentPnl: 1.39,
//   durationWin: 38.09995,
//   metrics: {
//     buys: 31,
//     sells: 16,
//     buyVolume: 25.777348097999997,
//     sellVolume: 22.187921709000005
//   }
// }
// {
//   maker: 'EPQ5f132T4DCrcnB5jwgWxfArsUcy2C9ZUyewG3Y8i6a',
//   pair: '5bN4mUwVb3GTeahxahF9vCXoXmfFWgeYQs9WSLNyQaJG',
//   sol: 44.482974748,
//   win: 1,
//   currentPnl: 0.76,
//   durationWin: 0,
//   metrics: {
//     buys: 2,
//     sells: 1,
//     buyVolume: 1.385458034,
//     sellVolume: 0.043812559
//   }
// }
// {
//   maker: '66W4ypeod8MegVzMot5ZJPEh6QBUG4FriDxC72bEJxvT',
//   pair: 'DRAFCw4wfVSTiecS3k3STRqafvDfPakPxqbAE7VLXwVa',
//   sol: 24.737655859,
//   win: 1.03,
//   currentPnl: 0.73,
//   durationWin: 0.21030000000000001,
//   metrics: {
//     buys: 2,
//     sells: 9,
//     buyVolume: 0.34982506,
//     sellVolume: 0.059151935999999995
//   }
// }
// {
//   maker: '4vJfp62jEzcYFnQ11oBJDgj6ZFrdEwcBBpoadNTpEWys',
//   pair: '5k2wDtW3nmXSx1wpCrfoES3FGnHZF5erSmN7ZGAE239j',
//   sol: 25.886377605,
//   win: 17.67,
//   currentPnl: 11.74,
//   durationWin: 22.277233333333335,
//   metrics: {
//     buys: 565,
//     sells: 513,
//     buyVolume: 1020.9015815920012,
//     sellVolume: 1010.74173354
//   }
// }
// {
//   maker: '3DLfq9HGAX8UTUpyxbNFGaNvz6chEyXERRfhhZpXcd7n',
//   pair: 'E6gzWA3potVftBTfZydHfc22wpMqnLRjunE8azB5QMje',
//   sol: 35.342173691,
//   win: 1.09,
//   currentPnl: 0.72,
//   durationWin: 0.1656,
//   metrics: {
//     buys: 13,
//     sells: 11,
//     buyVolume: 4.552024128,
//     sellVolume: 8.804150884
//   }
// }
// {
//   maker: '3NWAAa3PLFFvx59Lp2X6pX9tHFb23ASM68oFxExxgHVx',
//   pair: '3x8XZcCzJe3aPNL7HwBdrL2X6CZyoNZpmKoFNo5BQGn3',
//   sol: 484.197364235,
//   win: 2.86,
//   currentPnl: 2.22,
//   durationWin: 19.81066666666667,
//   metrics: {
//     buys: 52,
//     sells: 36,
//     buyVolume: 262.07801881800003,
//     sellVolume: 355.07612865300007
//   }
// }
// {
//   maker: 'C6ks9176P15hpRtcnt7TYS8F12yur1heVybekGtVZEBg',
//   pair: 'GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J',
//   sol: 25.932580111,
//   win: 1.05,
//   currentPnl: 1.03,
//   durationWin: 0.2954666666666667,
//   metrics: {
//     buys: 7,
//     sells: 2,
//     buyVolume: 2.0341749670000002,
//     sellVolume: 0.171779144
//   }
// }
// {
//   maker: '3VnD3WPjYm6eHnp9SN89QT5BZXGVfJY2j2VPaQGBaUDn',
//   pair: '3otkJA7d9EhSkj7sK9Sj5iSyjc9Ymq5Ry2nFHdpro19L',
//   sol: 24.987531171,
//   win: 1.04,
//   currentPnl: 0.99,
//   durationWin: 1.1836166666666665,
//   metrics: { buys: 0, sells: 0, buyVolume: 0, sellVolume: 0 }
// }
// {
//   maker: '4vJfp62jEzcYFnQ11oBJDgj6ZFrdEwcBBpoadNTpEWys',
//   pair: 'Er9NHHmQfoWQu3V3Tkv39sPxJTW93HfhQmcaXAtky4HL',
//   sol: 50.603780605,
//   win: 1.05,
//   currentPnl: 0.8,
//   durationWin: 0.02685,
//   metrics: {
//     buys: 31,
//     sells: 11,
//     buyVolume: 15.378688013000003,
//     sellVolume: 28.044254250999998
//   }
// }
// =========================== Closed Pool: 14 ======================
// 8LjfG2dAMgyTQmvKKT3VtwLgfxJc79RwkcLGuq19LSfC - 79.8796404sol - 1 - 0.97 - 0m
// D6Rgz1JG2syjsTXGaSAZ39cLffWL4TfabEAAnJHGRrZC - 50.429490857sol - 1.02 - 1.01 - 3.7139333333333338m
// Er9NHHmQfoWQu3V3Tkv39sPxJTW93HfhQmcaXAtky4HL - 24.987375sol - 1 - 0.82 - 0.0041m
// 5bN4mUwVb3GTeahxahF9vCXoXmfFWgeYQs9WSLNyQaJG - 29.7594sol - 1.07 - 0.94 - 0.00285m
// 9qGrQiDHtTpELR2DtPqUQwvNBxVYEuhjNdnK6k2SXfAN - 22.26397564sol - 1 - 1 - 0m
// Gj5t6KjTw3gWW7SrMHEi1ojCkaYHyvLwb17gktf96HNH - 34.79664133sol - 1 - 1 - 0.5882333333333333m
// 134Yy1wkG2pvxCVHjq81xmwCecfupVLVDShf2BqsRH2E - 24.653587021sol - 1.01 - 1 - 1.7975666666666668m
// Kassy1FHYjJ95xonC2SPfpAbieYu7goiGi321JuKjpF - 21.03291204sol - 1.71 - 1.61 - 51.073m
// 4mLVKoaTB8C2KotdrmKtU8ryx95QZaztNRScjBRr7PjE - 28.529150212sol - 1.07 - 1.01 - 0.6539333333333333m
// CWFGGyz6CLHmNPvBFwsKxkPLbDCtpCqRHYEctcy4hpHE - 20.336462402sol - 1 - 1 - 1.1223333333333334m
// Gj5t6KjTw3gWW7SrMHEi1ojCkaYHyvLwb17gktf96HNH - 31.720993031sol - 1 - 0.99 - 0m
// 8LjfG2dAMgyTQmvKKT3VtwLgfxJc79RwkcLGuq19LSfC - 26.716668329sol - 1 - 0.95 - 0m
// 7wHHYEQcgwFUupDF1yTU9gmEJUdVqGiweDYHr6ZRUXWf - 26.762705505sol - 1.19 - 1.09 - 18.4296m
// 3otkJA7d9EhSkj7sK9Sj5iSyjc9Ymq5Ry2nFHdpro19L - 24.987531171sol - 1.04 - 0.99 - 1.1836166666666665m