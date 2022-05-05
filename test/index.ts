import assert from 'assert';
import { decodeResumeToken, ResumeToken } from '../';
import { MongoClient, Db, Collection } from 'mongodb';
import bson from 'bson';

describe('decodeResumeToken', function() {
  this.timeout(10_000);

  let client: MongoClient;
  let db: Db;
  let coll: Collection;

  before(async() => {
    client = await MongoClient.connect('mongodb://localhost:27091');
  });

  after(async() => {
    await client.close();
  });

  beforeEach(async() => {
    db = client.db(`testdb-rt-${Date.now()}-${(Math.random() * 10000) | 0}`);
    coll = db.collection('test');
  });

  afterEach(async() => {
    await db.dropDatabase();
  });

  async function roundtrip(id: any): Promise<ResumeToken> {
    const csCursor = coll.watch();
    try {
      assert.strictEqual(await csCursor.tryNext(), null);
      await coll.insertOne({ _id: id });
      const data: any = await csCursor.tryNext();
      const resumeToken = decodeResumeToken(data._id._data);
      assert.deepStrictEqual(
        bson.EJSON.serialize(resumeToken.documentKey._id),
        bson.EJSON.serialize(id));
      return resumeToken;
    } finally {
      await csCursor.close();
    }
  }

  it('works for simple resume tokens', async() => {
    await roundtrip('abc');
  });

  it('works for resume tokens containing nested data structures', async() => {
    await roundtrip({ p: [{ z: 'abc' }] });
  });

  it('works for resume tokens containing strings with nul bytes', async() => {
    await roundtrip({ p: 'a\x00b\x01c\x02d' });
  });

  it('works for resume tokens containing bson objects', async() => {
    await roundtrip({
      t: new bson.Timestamp((Date.now() / 1000) | 0, 0),
      o: new bson.ObjectId(),
      m1: new bson.MinKey(),
      m2: new bson.MaxKey(),
      n: null,
      bt: true,
      bf: false,
      c1: new bson.Code('abc'),
      c2: new bson.Code('abc', { foo: 'bar' }),
      d: new Date(),
      r: new bson.BSONRegExp('banana', 'i'),
      dr1: new bson.DBRef('a', new bson.ObjectId()),
      dr2: new bson.DBRef('a', 'plainstring' as any),
      bs: new bson.Binary(Buffer.alloc(10, '.')),
      bl: new bson.Binary(Buffer.alloc(1000, '.'))
    });
  });

  it('works for resume tokens containing different numeric values', async() => {
    await roundtrip({
      a: [
        NaN,
        0,
        1,
        1.1,
        -1,
        0.5,
        -0.5,
        Infinity,
        -Infinity,
        -256,
        -65536,
        -16777216,
        -4294967296,
        4294967296
      ]
    });
  });

  it('can decode non-document resume tokens', async() => {
    const decoded = decodeResumeToken('82612F653E000000022B0229296E04');
    assert.deepStrictEqual(bson.EJSON.serialize(decoded), {
      timestamp: { $timestamp: { t: 1630496062, i: 2 } },
      version: 1,
      tokenType: 0,
      txnOpIndex: 0,
      fromInvalidate: false,
      uuid: null,
      documentKey: null
    });
  });

  // See PM-1950
  it('can decode new resume tokens', async() => {
    const decoded = decodeResumeToken('826275077A000000012B042C0100296E5A1004BFFDB617400E486099007C0E0048B305463C6F7065726174696F6E54797065003C696E736572740046646F63756D656E744B65790046645F696400646275077A2F3159F971E405C6000004');
    assert.deepStrictEqual(decoded, {
      documentKey: {
        documentKey: {
          _id: new bson.ObjectID('6275077a2f3159f971e405c6')
        },
        operationType: 'insert'
      },
      fromInvalidate: false,
      timestamp: new bson.Timestamp({
        t: 1651836794,
        i: 1
      }),
      tokenType: 128,
      txnOpIndex: 0,
      uuid: new bson.UUID('bffdb617-400e-4860-9900-7c0e0048b305'),
      version: 2
    });
  });
});
