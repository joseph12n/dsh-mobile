import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from './push.js';

describe('urlBase64ToUint8Array', () => {
  it('decodifica base64url con y sin relleno', () => {
    expect([...urlBase64ToUint8Array('AQID-_8')]).toEqual([1, 2, 3, 251, 255]);
    expect([...urlBase64ToUint8Array('AQID-_8=')]).toEqual([1, 2, 3, 251, 255]);
  });
});
