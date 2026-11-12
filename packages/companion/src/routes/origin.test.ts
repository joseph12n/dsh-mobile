import { describe, expect, it } from 'vitest';
import {
  isLoopbackHost,
  isValidOrigin,
  noticeHeadline,
  originNotice,
  publicOriginFor,
} from './origin.js';

/**
 * El QR tiene que llevar una dirección que el teléfono alcance.
 *
 * Este módulo nació de un fallo real: el enlace apuntaba siempre a `127.0.0.1`,
 * y escaneado desde un móvil eso es el propio móvil.
 *
 * La cabecera `Host` la controla el cliente, así que `publicOriginFor` **no puede
 * lanzar nunca**: un valor inválido llegaba a `new URL()` y tumbaba la petición.
 */

describe('detección de loopback', () => {
  it('reconoce las formas de loopback', () => {
    for (const host of [
      '127.0.0.1',
      '127.0.0.1:6768',
      'localhost',
      'localhost:3000',
      '::1',
      '[::1]:6768',
    ]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it('no confunde una IP privada con loopback', () => {
    for (const host of ['192.168.1.50:6768', '10.0.0.2', 'maquina.tailnet.ts.net']) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });

  it('tolera mayúsculas y el punto final de una dirección', () => {
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('localhost.')).toBe(true);
  });

  it('no lanza con entradas absurdas', () => {
    for (const host of ['', '   ', 'a b', '[::1', 'ejemplo:99999', ':::', 'x'.repeat(500)]) {
      expect(() => isLoopbackHost(host), host).not.toThrow();
    }
  });
});

describe('validación de origen', () => {
  it('acepta http y https', () => {
    expect(isValidOrigin('https://maquina.tailnet.ts.net')).toBe(true);
    expect(isValidOrigin('http://127.0.0.1:6768')).toBe(true);
  });

  it('rechaza lo que no es un origen', () => {
    for (const value of ['no es una url', '', 'ftp://x', 'ht!tp://x', 'ejemplo:99999']) {
      expect(isValidOrigin(value), value).toBe(false);
    }
  });
});

describe('origen público', () => {
  it('la configuración explícita manda siempre', () => {
    expect(
      publicOriginFor({
        host: '127.0.0.1:6768',
        fallbackPort: 6768,
        configured: 'https://maquina.tailnet.ts.net/',
      }),
    ).toBe('https://maquina.tailnet.ts.net');
  });

  it('usa el host por el que entró la petición', () => {
    expect(publicOriginFor({ host: 'maquina.tailnet.ts.net', fallbackPort: 6768 })).toBe(
      'https://maquina.tailnet.ts.net',
    );
  });

  it('un host de loopback va por http', () => {
    expect(publicOriginFor({ host: '127.0.0.1:6768', fallbackPort: 6768 })).toBe(
      'http://127.0.0.1:6768',
    );
  });

  it('respeta un proxy que declara https', () => {
    expect(
      publicOriginFor({
        host: 'maquina.tailnet.ts.net',
        forwardedProto: 'https',
        fallbackPort: 6768,
      }),
    ).toBe('https://maquina.tailnet.ts.net');
  });

  it('respeta un proxy que declara http sobre un host no loopback', () => {
    // Sin esta rama, el caso se confundiría con el fallback de https y la prueba
    // anterior pasaría sin probar nada.
    expect(
      publicOriginFor({
        host: 'maquina.tailnet.ts.net',
        forwardedProto: 'http',
        fallbackPort: 6768,
      }),
    ).toBe('http://maquina.tailnet.ts.net');
  });

  it('toma el primer valor de una cadena de proxies', () => {
    expect(
      publicOriginFor({
        host: 'maquina.tailnet.ts.net',
        forwardedProto: 'https, http',
        fallbackPort: 1,
      }),
    ).toBe('https://maquina.tailnet.ts.net');
  });

  it('sin cabecera Host cae al listener', () => {
    expect(publicOriginFor({ fallbackPort: 6768 })).toBe('http://127.0.0.1:6768');
  });

  describe('nunca lanza y siempre devuelve un origen válido', () => {
    const raros = [
      'a b',
      'ejemplo:99999',
      '[::1',
      '',
      '   ',
      'host con espacios:80',
      'x'.repeat(500),
      '\u0000malo',
      'http://',
    ];

    for (const host of raros) {
      it(`con Host ${JSON.stringify(host.slice(0, 24))}`, () => {
        const origin = publicOriginFor({ host, fallbackPort: 6768 });
        expect(isValidOrigin(origin)).toBe(true);
        expect(origin).toBe('http://127.0.0.1:6768');
      });
    }
  });

  it('una configuración inválida también cae al listener', () => {
    expect(publicOriginFor({ fallbackPort: 6768, configured: 'no es url' })).toBe(
      'http://127.0.0.1:6768',
    );
  });
});

describe('avisos para la página de emparejamiento', () => {
  it('es bloqueante cuando el destino es loopback', () => {
    const notice = originNotice('http://127.0.0.1:6768');
    expect(notice?.severity).toBe('blocking');
    expect(notice?.message).toContain('127.0.0.1:6768');
    expect(notice?.message).toContain('phone');
  });

  it('es solo un aviso cuando va por HTTP sin ser loopback: la app carga', () => {
    const notice = originNotice('http://192.168.1.50:6768');
    expect(notice?.severity).toBe('warning');
    expect(notice?.message).toContain('will load');
    expect(notice?.message).toContain('instalarse');
    expect(noticeHeadline(notice!)).toContain('will not be able to install it');
  });

  it('no avisa en un destino correcto por HTTPS', () => {
    expect(originNotice('https://maquina.tailnet.ts.net')).toBeUndefined();
  });

  it('es bloqueante si la dirección no es válida', () => {
    const notice = originNotice('no es una url');
    expect(notice?.severity).toBe('blocking');
    expect(notice?.message).toContain('is not valid');
  });

  it('el titular depende de la gravedad', () => {
    expect(noticeHeadline({ severity: 'blocking', message: '' })).toContain('will not work');
    expect(noticeHeadline({ severity: 'warning', message: '' })).toContain('install it');
  });
});
