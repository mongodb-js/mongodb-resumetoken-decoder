import { decodeResumeToken } from './';
if (!process.argv[2].match(/([A-Z0-9]{2})*/i)) {
  throw new Error('Usage: mongodb-resumetoken-decoder <hex string>');
}
console.dir(decodeResumeToken(process.argv[2]), { depth: Infinity, customInspect: true });
