export class Random {
  constructor(hash) {
    let offset = 0;
    for (let i = 2; i < 66; i += 8) offset += parseInt(hash.substr(i, 8), 16);
    offset %= 7;

    const p = pos => parseInt(hash.substr((pos + offset), 8), 16);
    let a = p(2) ^ p(34), b = p(10) ^ p(42), c = p(18) ^ p(50), d = p(26) ^ p(58) ^ p(2 + (8 - offset));

    this.r = () => {
      a |= 0; b |= 0; c |= 0; d |= 0;
      let t = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0; a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
    for (let i = 0; i < 256; i++) this.r();
  }

  random_dec   = () => this.r();
  random_num   = (a, b) => a + (b - a) * this.random_dec();
  random_int   = (a, b) => Math.floor(this.random_num(a, b + 1));
  random_bool  = (p) => this.random_dec() < p;
  random_choice = (list) => list[this.random_int(0, list.length - 1)];
}
