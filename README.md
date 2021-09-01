# mongodb-resumetoken-decoder

A library for decoding MongoDB resume tokens.

```js
$ npx mongodb-resumetoken-decoder 82612E8513000000012B022C0100296E5A1004A5093ABB38FE4B9EA67F01BB1A96D812463C5F6964003C5F5F5F78000004
{
  timestamp: new Timestamp({ t: 1630438675, i: 1 }),
  version: 1,
  tokenType: 128,
  txnOpIndex: 0,
  fromInvalidate: false,
  uuid: new UUID("a5093abb-38fe-4b9e-a67f-01bb1a96d812"),
  documentKey: { _id: '___x' }
}
```

## LICENSE

SSPL
