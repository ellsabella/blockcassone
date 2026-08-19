import fs from 'node:fs';
const ROOT = '/mnt/c/Users/ellag/Desktop/blockcassone';

const RAW = `0x0043b3590b5dccf6a4fdc4352d517156dc350043
0x0087b8616714e74d681430bf4f9a1189965bb16f
0x00e81d0d81012e24a8c39aea69a9816c85409201
0x012c6934d9e8e1422a48af53948754b58f373169
0x0183645e27c363ed2d1a3e8b036b0877d7882f52
0x027f2bd2b7079a68d36eba434e6d5dce50cb7163
0x0377c5d6acadee75abba3070324e629fefac51e0
0x03d1d91db6050bc2e57d92fe8955c25724329b94
0x0d86ea66ae13a84fe0627da8afe326dbde91875c
0x0e7921e2aed48189c96aab7178e8f4380664479e
0x114661586c254799116df87fd540edcda19f2c60
0x13b402246cf4d859bcdedfe521b59dfab479baf4
0x160b94e11cad0c6233c9127dcf526803b5ddb51d
0x16e23099cca4092c6c7ea3a56506af6dcc58383a
0x170e47b365fee43bd9107a351b4acfef080a4e3e
0x19be634c0aa60db9b43494d05fd5a5f5d910aaeb
0x1cf82438699503567fa12d41ce80e92ca0a8aef7
0x1eaea502830f03646851b8451d14801d9c4bbbe6
0x23631b12402fe1b2404fccfab01557269b0df108
0x239e9e51a7a881221c4cec228e1d093b5a434dc8
0x2531b2ff6a7f08c6ab12c29d1b394788f819deb1
0x25e99f94bcf216055869520bb87e3d5e8c7269e8
0x26153ca3a54b0c54aeeeff9f2de50262af620118
0x26bf34d4b0a671f3b1627b9ff58d627f68cff7b0
0x296f6fe7cb12030ff4add93b6d653cfd723f17f1
0x3016dd9dd812290122ec453cb01b48d5a4aff602
0x30a54e68ed48e61a83e548703b86f5fcaf1ef062
0x310e8b5bba1e821dd6111006a43491f375959944
0x34a2438811b7dd3d14aca7f31542d4666e4c37ea
0x395e3849b2cf55fa9b5a00fc32bf1ec902251d4d
0x3a6372b2013f9876a84761187d933dee0653e377
0x3c114973c0260290c2dbd40323327d996972fceb
0x3d3b39e14c4a9cfdf89ba100ababa37d7938f9ee
0x40212db067c6d6123a6ec3f652180db9a61f3ac1
0x433d7931c5d1914378c7cc4123c54fae68bcaa53
0x45db9d3457c2cb05c4bfc7334a33cee6e19d508f
0x4643c42d35421c22ffcaae05cb842c1ab837c87e
0x46fa5eae590f53834c1d151c039d7fea2f3f1d52
0x4a3e6e66f8c32bc05a50879f872b1177a1573cdf
0x4ae5e79106a42e2e36bfc8ff3db0223e20341331
0x4cb75146e98562c9d79b31649c6c739e4dcb7cd5
0x4d13a7784bddc1ebe7b7084873ca033e935251f4
0x4dec51e66f061f74327697bf11d3f3990bc90621
0x4f764a08c66251e13bdd85b4bb0652b739736328
0x504ee56f8f2e8d5ca0eb36e2cbb3673828818794
0x50798bd42e2b9ea23cbcea10105bea7598eb8b15
0x552f01d67b352aaa38bc675e30ced97f2451df63
0x557193439e4360856268e14b78e740ed24fe6d9e
0x56503d9281d0234c8e2390d8c4c39ebc12929977
0x583c6a698dcef41dd588d577678a1c8045af2025
0x5c0ec6cd4a23fb4d2946fd51c6ce57f36d0902b1
0x61360c5e0641cefe9e22e877da550a331988a139
0x635123f0a1e192b03f69b3d082e79c969a5ee9b0
0x686adbfcaa75f7491bba9f8d035613671c11b507
0x6ab6188cfd6db835c9d8b21ff2bee08c95ca8710
0x6d172b55c95393285a1750da13b9c4bf968e4ea2
0x6d1b8a100a5be82b70d412274a8b1ee0169d2f4d
0x6db8e922741c8bc816b30e8c944c3002c3b6098c
0x6f3b66dba3c318c405a0733d5d2cd67bfd57aa08
0x6f3e619ebb91007803fa258589ceeaf2be939881
0x715ace80d98feaac6eed7c87f2a4f97b702816bb
0x72c6f7d9e9f887b47eaea1373dd5c0cfe081970b
0x735854c506cceb0b95c949d1acb705b31136d487
0x7537cb0aee6a3483a7601ebf1084ed4df73166ab
0x778432d01bf027ce111dcda8b83f87d105a54b9f
0x7aaf42b4fe258ea249e4102c2eb8da949f2633f2
0x7c0a31864938c2c2b63509dcc8aec314c1f619f3
0x7ccd2ee72a75f7e4776f598c1be11a119fd8d191
0x87d09f7d5edc558cff68852e839be6536b1ea3c1
0x8e9462e083144cfcb02ef030e602b8e1471909ff
0x9040f3cf1d419717dc59995e1b7b1b413ce26a2e
0x911c92d410afe1f06cd0bc551d62835634dbe014
0x94de7e2c73529ebf3206aa3459e699fbcdfcd49b
0x957973be80d90d21dbcef415ff39eec492591987
0x9737fae1031f43bc3e8fc72f31456ec3b34f80fb
0x9798ff4491c34a2047966b6682379f6b4d4797e7
0x97b08cce39acbf3347cc9b83b6ae4c3e6f1a30cb
0x98f1bda2d45ffaca73fcf2154e9e007871e14934
0x98fd5b2c5d57143d49519d5cfcf36908d7c31e33
0x9d5765595a92c560c8759d2a9c375c66123765a5
0xa00e4ba46907fcbf84b3ba22c7b5689e6db827a0
0xa02bc4096aac798ecb350a07024919a3638b2eb9
0xa1454995cccc837fac7ef1d91a1544730c79b306
0xa2cd74d34383da20f9dd065ae4377e7324bcf708
0xa5f72cbeb1bfd1ba5c29876ba54ff82004a45791
0xa6b5b934ac0821dd1b8667673d053db893f71ab2
0xa75c93e895dc2fb3b034bf4ac59cf85c4c99ae1f
0xa764b14e9d588dcf8c668965a53b02168553e108
0xaabeffc7c115cc9af5b55a8f653113a929558ecd
0xad84fd207cc645621fff9b31b8edc5c1292566d2
0xadf1591e226f95ee08d5d8bf1a7bda7859fe1fcf
0xaf96c391322e600c0227044ad8e781fd366f454b
0xb0cb30abf4c7d82a9be9ac488e3df4147efe6616
0xb120839bfb092cef28315e6c35a0797e1952d535
0xb38cb828f680b3919fe45ee557e180f19c89216e
0xb464ca834796272e08dc6460940b281b046a2cee
0xb48e8da63c2afc5633702b7acf4bde830c1de48b
0xbe957a475844c127ddd207b4ff1f63900fd13e57
0xc09d4da82c2119cae8d2b46c5b81507bf9920230
0xc0c00503ba8f1adea1d0650dde420ca606903533
0xc7cb454cefd11a346c5307d4865b5bb687aaad46
0xcf88fa6ee6d111b04be9b06ef6fad6bd6691b88c
0xd3c624134166c385256f125cac3aed2ff18134a3
0xd408153be73c87d6d022a8f43cef48d631205fac
0xda235de9a724d42bf58f3f76d5b63525d7e19faa
0xdc4e35804eddcf982e9f97030ef7927972c75e3a
0xde45bb87d7400eab68d99bbe33ede4bbfed92104
0xe3e06e9ec56ac1e7f3bced968b920d46ae1b460a
0xe6c95cf4a1ae50bb83c103d0f49ad80d11b04912
0xe88e925215dd9f1999385f0a9c5fd39e4b319e60
0xec25a5c70879dfc891bf4d7499fecf10e2c1cf6f
0xee8bd6263f94d61d77d0ceb12275808826ff0ae4
0xf153953d0ac3522d91cf1872b8f869f9f6030aa4
0xf54fe7f5f0f8d13ce9b685b8ad167b466b637f0d
0xf6e212a8d6f1b3bd5c99ae254866bd30bbede1c8
0xf70f9dc8b0209a1f83ed2bf026694a6db8c56fbe
0xfaadaba2541488c4ac5f4888da1019708e3fae0c
0xfc2ae61a0a5e2139a94b41d1a8530ff2ee5a3cbd
0xffc58ae9b148d8042f137a03d7d4b4263fe8097c`;

const input = [...new Set(RAW.trim().split('\n').map(l => l.trim().toLowerCase()).filter(w => /^0x[0-9a-f]{40}$/.test(w)))];

// GTD sets (with GTD2 nicknames for reporting)
const jl = fs.readFileSync(ROOT + '/allowlist-submissions.jsonl', 'utf8').split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const gtd1 = new Set(jl.filter(r => r.kind === 'gtd').map(r => String(r.wallet || '').toLowerCase()).filter(w => /^0x[0-9a-f]{40}$/.test(w)));
const gtd2nick = new Map(fs.readFileSync(ROOT + '/GTD2.txt', 'utf8').split('\n').filter(Boolean).map(l => { const p = l.split(','); return [p[0].toLowerCase(), p[1] || '']; }));

const fcfsArr = JSON.parse(fs.readFileSync(ROOT + '/fcfs-wallets.json', 'utf8')).map(a => a.toLowerCase());
const fcfsSet = new Set(fcfsArr);

const added = [], inFcfs = [], inGtd = [];
for (const a of input) {
  if (gtd1.has(a) || gtd2nick.has(a)) { inGtd.push(a); continue; }
  if (fcfsSet.has(a)) { inFcfs.push(a); continue; }
  fcfsSet.add(a); added.push(a);
}

fs.writeFileSync(ROOT + '/fcfs-wallets.json', JSON.stringify([...fcfsSet], null, 2));
// append 0-balance CSV rows (manual adds — no per-collection snapshot data)
const csv = fs.readFileSync(ROOT + '/fcfs-holders.csv', 'utf8');
const nCols = csv.split('\n')[0].split(',').length;                  // wallet + collections + total
const zeros = new Array(nCols - 2).fill(0).join(',');
if (added.length) fs.appendFileSync(ROOT + '/fcfs-holders.csv', added.map(a => `${a},${zeros},0`).join('\n') + '\n');

console.log(`input (unique): ${input.length}`);
console.log(`  + added to FCFS: ${added.length}`);
console.log(`  · already in FCFS (skipped): ${inFcfs.length}`);
console.log(`  · already in GTD (skipped — higher tier): ${inGtd.length}`);
for (const a of inGtd) console.log(`      ${a}  ${gtd1.has(a) ? '(GTD1)' : 'GTD2:' + gtd2nick.get(a)}`);
console.log(`  = FCFS total now: ${fcfsSet.size}`);
