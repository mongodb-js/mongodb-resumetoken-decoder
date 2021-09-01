import { keystringToBson } from './';
import type { Timestamp, Binary } from 'bson';

export interface ResumeToken {
  timestamp: Timestamp;
  version: number;
  tokenType: number | undefined;
  txnOpIndex: number;
  fromInvalidate: boolean | undefined;
  uuid: Binary | undefined;
  documentKey: any;
}

export function decodeResumeToken(input: string): ResumeToken {
  const bson = keystringToBson('v1', input);
  const timestamp = bson.shift();
  const version = bson.shift();
  const tokenType = version >= 1 ? bson.shift() : undefined;
  const txnOpIndex = bson.shift();
  const fromInvalidate = version >= 1 ? bson.shift() : undefined;
  const uuid = bson.shift().toUUID();
  const documentKey = bson.shift();
  return {
    timestamp, version, tokenType, txnOpIndex, fromInvalidate, uuid, documentKey
  };
}
