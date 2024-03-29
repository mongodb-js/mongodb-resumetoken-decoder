import { keystringToBson } from './';
import type { Timestamp, Binary, UUID } from 'bson';

export type ResumeToken = {
  timestamp: Timestamp;
  version: number;
  tokenType: number | undefined;
  txnOpIndex: number;
  fromInvalidate: boolean | undefined;
  uuid: UUID | undefined;
} &
  ({ documentKey?: any; eventIdentifier?: never } | { documentKey?: never; eventIdentifier?: any })

function maybeToUUID(data: Binary | undefined): UUID | undefined {
  if (data) {
    return (data as any).toUUID(); // TODO: .toUUID() should probably be public API
  }
  return undefined;
}

export function decodeResumeToken(input: string): ResumeToken {
  const bson = keystringToBson('v1', input);
  const timestamp = bson.shift();
  const version = bson.shift();
  const tokenType = version >= 1 ? bson.shift() : undefined;
  const txnOpIndex = bson.shift();
  const fromInvalidate = version >= 1 ? bson.shift() : undefined;
  const uuid = maybeToUUID(bson.shift());
  const identifierValue = bson.shift();
  const identifierKey = version === 2 ? 'eventIdentifier' : 'documentKey';
  return {
    timestamp, version, tokenType, txnOpIndex, fromInvalidate, uuid, [identifierKey]: identifierValue
  };
}
