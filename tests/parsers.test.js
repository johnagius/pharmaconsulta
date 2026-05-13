import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch } from '../src/parsers/index.js';
import { detectProduct } from '../src/data/midCodes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('PDF parsers', () => {
  it('parses a D.H. single-order PDF text', () => {
    const orders = dispatch(fixture('dh.txt'));
    expect(orders).toHaveLength(1);
    const o = orders[0];
    expect(o.source).toBe('dh');
    expect(o.orderId).toBe('3092300');
    expect(o.recipient.name).toBe('Paula Cunningham');
    expect(o.recipient.line1).toBe('62 RIDGEWOOD DR');
    expect(o.recipient.city).toBe('TAUNTON');
    expect(o.recipient.state).toBe('MA');
    expect(o.recipient.postcode).toBe('02780');
    expect(o.recipient.phone).toBe('7742184083');
    expect(o.recipient.email).toBe('taraatgww@yahoo.com');
    expect(o.productText).toMatch(/Ozempic/i);
    expect(detectProduct(o.productText).key).toBe('ozempic');
  });

  it('parses an Activa order PDF text', () => {
    const orders = dispatch(fixture('activa.txt'));
    expect(orders).toHaveLength(1);
    const o = orders[0];
    expect(o.source).toBe('activa');
    expect(o.recipient.name).toBe('Desire Layfield');
    expect(o.recipient.line1).toBe('5422 Cumming Hwy NE');
    expect(o.recipient.line2).toBe('Ste 104');
    expect(o.recipient.city).toBe('Sugar Hill');
    expect(o.recipient.state).toBe('GA');
    expect(o.recipient.postcode).toBe('30518');
    expect(o.recipient.phone).toBe('6787658162');
    expect(o.productText).toMatch(/BOT 50IU/);
    expect(detectProduct(o.productText).key).toBe('botox');
  });

  it('parses a K2 multi-order PDF text', () => {
    const orders = dispatch(fixture('k2.txt'));
    expect(orders.length).toBeGreaterThanOrEqual(2);
    const kevin = orders.find((o) => o.recipient.name === 'Kevin Reilly');
    expect(kevin).toBeDefined();
    expect(kevin.recipient.line1).toBe('42 HUNTTING AVE');
    expect(kevin.recipient.city).toBe('EAST HAMPTON');
    expect(kevin.recipient.state).toBe('NY');
    expect(kevin.recipient.postcode).toBe('11937-2205');
    expect(kevin.recipient.phone).toBe('6317939695');
    expect(kevin.recipient.country).toBe('US');
    expect(kevin.productText).toMatch(/RESTYLANE/i);
    expect(detectProduct(kevin.productText).key).toBe('restylane');

    const george = orders.find((o) => o.recipient.name === 'George Hererra');
    expect(george).toBeDefined();
    expect(george.recipient.state).toBe('FL');
    expect(detectProduct(george.productText).key).toBe('dysport');
  });

  it('parses a PDMS prescription PDF text', () => {
    const orders = dispatch(fixture('pdms.txt'));
    expect(orders).toHaveLength(1);
    const o = orders[0];
    expect(o.source).toBe('pdms');
    expect(o.recipient.name).toBe('Monica Reilly');
    expect(o.recipient.line1).toBe('4197 VERMONT AVE');
    expect(o.recipient.city).toBe('GRAND ISLAND');
    expect(o.recipient.state).toBe('NE');
    expect(o.recipient.postcode).toBe('68803-1061');
    expect(o.productText).toMatch(/Orencia/i);
    expect(detectProduct(o.productText).key).toBe('orencia');
  });

  it('parses a Secil short-order PDF text', () => {
    const orders = dispatch(fixture('secil.txt'));
    expect(orders).toHaveLength(1);
    const o = orders[0];
    expect(o.source).toBe('secil');
    expect(o.recipient.name).toBe('Elizabeth VanderPloeg');
    expect(o.recipient.line1).toBe('2783 Creekview Trl');
    expect(o.recipient.city).toBe('Palo');
    expect(o.recipient.state).toBe('IA');
    expect(o.recipient.postcode).toBe('52324');
    expect(o.recipient.phone).toBe('+13192135424');
    expect(o.recipient.email).toBe('evploeg26@gmail.com');
    expect(o.productText).toMatch(/Meriofert/i);
  });
});
