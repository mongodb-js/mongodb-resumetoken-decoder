import { keystringToBson } from './';
import type { Timestamp, Binary, UUID } from 'bson';

export type ResumeToken = {
  timestamp: Timestamp;
  version: number;
  tokenType: number | undefined;
  txnOpIndex: number;
  fromInvalidate: boolean | undefined;
  uuid: UUID | undefined;
  fragmentNum?: number;
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
  // Change events that exceed the 16MB BSON limit can be split into multiple
  // fragments via the $changeStreamSplitLargeEvent stage. In that case the
  // resume token carries a trailing `fragmentNum` (v2+ tokens only). It is
  // absent for regular, non-split events.
  const fragmentNum = version >= 2 ? bson.shift() : undefined;
  return {
    timestamp,
    version,
    tokenType,
    txnOpIndex,
    fromInvalidate,
    uuid,
    [identifierKey]: identifierValue,
    ...(fragmentNum !== undefined ? { fragmentNum } : {})
  };
}
