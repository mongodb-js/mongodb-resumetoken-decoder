import bson from 'bson';

// This code is adapted from
// https://github.com/mongodb/mongo/blob/6e34f5094204aaf9bf14b51252ab347b4035b584/src/mongo/db/storage/key_string.cpp
// with the omission of support for inverted fields (i.e. different ordering),
// type information, and no full Decimal128 support.

class CType {
  static kMinKey = 10;
  static kUndefined = 15;
  static kNullish = 20;
  static kNumeric = 30;
  static kStringLike = 60;
  static kObject = 70;
  static kArray = 80;
  static kBinData = 90;
  static kOID = 100;
  static kBool = 110;
  static kDate = 120;
  static kTimestamp = 130;
  static kRegEx = 140;
  static kDBRef = 150;
  static kCode = 160;
  static kCodeWithScope = 170;
  static kMaxKey = 240;

  static kNumericNaN = this.kNumeric + 0;
  static kNumericNegativeLargeMagnitude = this.kNumeric + 1; // <= -2**63 including -Inf
  static kNumericNegative8ByteInt = this.kNumeric + 2;
  static kNumericNegative7ByteInt = this.kNumeric + 3;
  static kNumericNegative6ByteInt = this.kNumeric + 4;
  static kNumericNegative5ByteInt = this.kNumeric + 5;
  static kNumericNegative4ByteInt = this.kNumeric + 6;
  static kNumericNegative3ByteInt = this.kNumeric + 7;
  static kNumericNegative2ByteInt = this.kNumeric + 8;
  static kNumericNegative1ByteInt = this.kNumeric + 9;
  static kNumericNegativeSmallMagnitude = this.kNumeric + 10; // between 0 and -1 exclusive
  static kNumericZero = this.kNumeric + 11;
  static kNumericPositiveSmallMagnitude = this.kNumeric + 12; // between 0 and 1 exclusive
  static kNumericPositive1ByteInt = this.kNumeric + 13;
  static kNumericPositive2ByteInt = this.kNumeric + 14;
  static kNumericPositive3ByteInt = this.kNumeric + 15;
  static kNumericPositive4ByteInt = this.kNumeric + 16;
  static kNumericPositive5ByteInt = this.kNumeric + 17;
  static kNumericPositive6ByteInt = this.kNumeric + 18;
  static kNumericPositive7ByteInt = this.kNumeric + 19;
  static kNumericPositive8ByteInt = this.kNumeric + 20;
  static kNumericPositiveLargeMagnitude = this.kNumeric + 21; // >= 2**63 including +Inf

  static kBoolFalse = this.kBool + 0;
  static kBoolTrue = this.kBool + 1;
}

const kEnd = 4;
const kLess = 1;
const kGreater = 254;

function numBytesForInt(ctype: number): number {
  if (ctype >= CType.kNumericPositive1ByteInt) {
    return ctype - CType.kNumericPositive1ByteInt + 1;
  }

  return CType.kNumericNegative1ByteInt - ctype + 1;
}

class BufferConsumer {
  buf: Uint8Array;
  index = 0;
  textDecoder = new TextDecoder();

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  peekUint8(): number | undefined {
    return this.buf[this.index];
  }

  readUint8(): number {
    if (this.index >= this.buf.length) { throw new RangeError('unexpected end of input'); }

    return this.buf[this.index++];
  }

  readUint32BE(): number {
    return this.readUint8() * (1 << 24) +
           this.readUint8() * (1 << 16) +
           this.readUint8() * (1 << 8) +
           this.readUint8();
  }

  readUint64BE(): bigint {
    return (BigInt(this.readUint32BE()) << 32n) + BigInt(this.readUint32BE());
  }

  readBytes(n: number): Uint8Array {
    if (this.index + n > this.buf.length) { throw new RangeError('unexpected end of input'); }

    const ret = this.buf.subarray(this.index, this.index + n);
    this.index += n;
    return ret;
  }

  readCString(): string {
    let end = this.buf.indexOf(0, this.index);
    if (end === -1) { end = this.buf.length; }
    const str = this.textDecoder.decode(this.readBytes(end - this.index));
    this.readUint8(); // \0
    return str;
  }

  readCStringWithNuls(): string {
    let str = this.readCString();
    while (this.peekUint8() === 0xff) {
      this.readUint8();
      str += '\0' + this.readCString();
    }
    return str;
  }
}

function uint8ArrayToHex(arr: Uint8Array): string {
  return [...arr].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToUint8Array(str: string): Uint8Array {
  return new Uint8Array((str.match(/../g) ?? []).map(byte => parseInt(byte, 16)));
}

const ieee754dv = new DataView(new ArrayBuffer(8));
function read64BitIEEE754(val: bigint): number {
  ieee754dv.setBigUint64(0, val);
  return ieee754dv.getFloat64(0);
}

function countLeadingZeros64(num: bigint): number {
  num &= 0xffff_ffff_ffff_ffffn;
  const high = num >> 32n;
  if (high !== 0n) {
    return Math.clz32(Number(high));
  }
  return 32 + Math.clz32(Number(num));
}

type KeyStringVersion = 'v0' | 'v1';

function readValue(ctype: number, version: KeyStringVersion, buf: BufferConsumer): any {
  let isNegative = false;
  switch (ctype) {
    case CType.kMinKey:
      return new bson.MinKey();
    case CType.kMaxKey:
      return new bson.MaxKey();
    case CType.kNullish:
      return null;
    case CType.kUndefined:
      return undefined;
    case CType.kBoolTrue:
      return true;
    case CType.kBoolFalse:
      return false;
    case CType.kDate:
      return new Date(Number(buf.readUint64BE() ^ (1n << 63n)));
    case CType.kTimestamp: {
      const t = buf.readUint32BE();
      const i = buf.readUint32BE();
      return new bson.Timestamp({ t, i });
    }
    case CType.kOID:
      return new bson.ObjectId(uint8ArrayToHex(buf.readBytes(12)));
    case CType.kStringLike:
      return buf.readCStringWithNuls();
    case CType.kCode:
      return new bson.Code(buf.readCStringWithNuls());
    case CType.kCodeWithScope: {
      const code = buf.readCStringWithNuls();
      const scope = keystringToBsonPartial(version, buf, 'named');
      return new bson.Code(code, scope);
    }
    case CType.kBinData: {
      let size = buf.readUint8();
      if (size === 0xff) {
        size = buf.readUint32BE();
      }
      const subtype = buf.readUint8();
      return new bson.Binary(buf.readBytes(size), subtype);
    }
    case CType.kRegEx: {
      const pattern = buf.readCString();
      const flags = buf.readCString();
      return new bson.BSONRegExp(pattern, flags);
    }
    case CType.kDBRef: {
      const size = buf.readUint32BE();
      const ns = buf.readBytes(size).toString();
      const oid = new bson.ObjectId(uint8ArrayToHex(buf.readBytes(12)));
      return new bson.DBRef(ns, oid); // TODO: What happens to non-OID DBRefs?
    }
    case CType.kObject:
      return keystringToBsonPartial(version, buf, 'named');
    case CType.kArray: {
      const arr = [];
      while (buf.peekUint8() !== 0) {
        arr.push(keystringToBsonPartial(version, buf, 'single'));
      }
      buf.readUint8();
      return arr;
    }
    case CType.kNumericNaN:
      return NaN;
    case CType.kNumericZero:
      return 0;
    case CType.kNumericNegativeLargeMagnitude:
      isNegative = true;
      // fallthrough
    case CType.kNumericPositiveLargeMagnitude: {
      let encoded = buf.readUint64BE();
      if (isNegative) {
        encoded = (~encoded) & ((1n << 64n) - 1n);
      }
      if (version === 'v0') {
        return read64BitIEEE754(encoded);
      } else if (!(encoded & (1n << 63n))) { // In range of (finite) doubles
        const hasDecimalContinuation = encoded & 1n;
        encoded >>= 1n; // remove decimal continuation marker
        encoded |= 1n << 62n; // implied leading exponent bit
        let bin = read64BitIEEE754(encoded);
        if (isNegative) { bin = -bin; }
        if (hasDecimalContinuation) { buf.readUint64BE(); }
        return bin;
      } else if (encoded === 0xffff_ffff_ffff_ffffn) { // Infinity
        return isNegative ? -Infinity : Infinity;
      } else {
        buf.readUint64BE(); // low bits
        return isNegative ? -Infinity : Infinity;
      }
    }
    case CType.kNumericNegativeSmallMagnitude:
      isNegative = true;
      // fallthrough
    case CType.kNumericPositiveSmallMagnitude: {
      let encoded = buf.readUint64BE();
      if (isNegative) {
        encoded = (~encoded) & ((1n << 64n) - 1n);
      }
      if (version === 'v0') {
        return read64BitIEEE754(encoded);
      }
      switch (encoded >> 62n) {
        case 0x0n: {
          // Teeny tiny decimal, smaller magnitude than 2**(-1074)
          buf.readUint64BE();
          return 0;
        }
        case 0x1n:
        case 0x2n: {
          const hasDecimalContinuation = encoded & 1n;
          encoded -= 1n << 62n;
          encoded >>= 1n;
          const scaledBin = read64BitIEEE754(encoded);
          const bin = scaledBin * (1 ** -256);
          if (hasDecimalContinuation) { buf.readUint64BE(); }
          return isNegative ? -bin : bin;
        }
        case 0x3n: {
          encoded >>= 2n;
          const bin = read64BitIEEE754(encoded);
          return isNegative ? -bin : bin;
        }
        default:
          throw new Error('unreachable');
      }
    }

    case CType.kNumericNegative8ByteInt:
    case CType.kNumericNegative7ByteInt:
    case CType.kNumericNegative6ByteInt:
    case CType.kNumericNegative5ByteInt:
    case CType.kNumericNegative4ByteInt:
    case CType.kNumericNegative3ByteInt:
    case CType.kNumericNegative2ByteInt:
    case CType.kNumericNegative1ByteInt:
      isNegative = true;
      // fallthrough (format is the same as positive, but inverted)
    case CType.kNumericPositive1ByteInt:
    case CType.kNumericPositive2ByteInt:
    case CType.kNumericPositive3ByteInt:
    case CType.kNumericPositive4ByteInt:
    case CType.kNumericPositive5ByteInt:
    case CType.kNumericPositive6ByteInt:
    case CType.kNumericPositive7ByteInt:
    case CType.kNumericPositive8ByteInt: {
      let encodedIntegerPart = 0n;
      {
        let intBytesRemaining = numBytesForInt(ctype);
        while (intBytesRemaining--) {
          let byte = buf.readUint8();
          if (isNegative) { byte = ~byte & 0xff; }
          encodedIntegerPart = (encodedIntegerPart << 8n) | BigInt(byte);
        }
      }
      const haveFractionalPart = (encodedIntegerPart & 1n);
      let integerPart = encodedIntegerPart >> 1n;
      if (!haveFractionalPart) {
        if (isNegative) { integerPart = -integerPart; }
        if (Number.isSafeInteger(Number(integerPart))) { return Number(integerPart); }
        return integerPart;
      }

      if (version === 'v0') {
        // KeyString V0: anything fractional is a double
        const exponent = (64 - countLeadingZeros64(integerPart)) - 1;
        const fractionalBits = 52 - exponent;
        const fractionalBytes = ((fractionalBits + 7) / 8) | 0;

        let doubleBits = integerPart << BigInt(fractionalBits);
        doubleBits &= ~(1n << 52n);
        doubleBits |= (BigInt(exponent) + 1023n) << 52n;
        if (isNegative) {
          doubleBits |= (1n << 63n);
        }
        for (let i = 0; i < fractionalBytes; i++) {
          let byte = buf.readUint8();
          if (isNegative) { byte = ~byte & 0xff; }
          doubleBits |= BigInt(byte) << BigInt((fractionalBytes - i - 1) * 8);
        }
        return read64BitIEEE754(doubleBits);
      }

      // KeyString V1: all numeric values with fractions have at least 8 bytes.
      // Start with integer part, and read until we have a full 8 bytes worth of data.
      const fracBytes = 8 - numBytesForInt(ctype);
      let encodedFraction = integerPart;
      for (let fracBytesRemaining = fracBytes; fracBytesRemaining; fracBytesRemaining--) {
        let byte = buf.readUint8();
        if (isNegative) { byte = ~byte & 0xff; }
        encodedFraction = (encodedFraction << 8n) | BigInt(byte);
      }

      // Zero out the DCM and convert the whole binary fraction
      const bin = Number(encodedFraction & ~3n) * 2 ** (-8 * fracBytes);
      const dcm = fracBytes ? (encodedFraction & 3n) : 3n;
      if (dcm !== 0n && dcm !== 2n) {
        buf.readUint64BE();
      }

      return isNegative ? -bin : bin;
    }
    default:
      throw new Error(`Unknown keystring ctype ${ctype}`);
  }
}

function keystringToBsonPartial(version: KeyStringVersion, buf: BufferConsumer, mode: 'toplevel' | 'single' | 'named'): any {
  const contents: any = mode === 'named' ? {} : [];
  while (buf.peekUint8() !== undefined) {
    let ctype = buf.readUint8();
    if (ctype === kLess || ctype === kGreater) {
      ctype = buf.readUint8();
    }
    if (ctype === kEnd) { break; }
    if (mode === 'named') {
      if (ctype === 0) { break; }
      const key = buf.readCString();
      ctype = buf.readUint8(); // again ctype, but more accurate this time
      contents[key] = readValue(ctype, version, buf);
    } else if (mode === 'single') {
      return readValue(ctype, version, buf);
    } else {
      contents.push(readValue(ctype, version, buf));
    }
  }
  return contents;
}

export function keystringToBson(version: KeyStringVersion, buf: Uint8Array | string): any {
  const asBuf = typeof buf === 'string' ? hexToUint8Array(buf) : buf;
  return keystringToBsonPartial(version, new BufferConsumer(asBuf), 'toplevel');
}
