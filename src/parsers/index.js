import * as activa from './activa.js';
import * as dh from './dh.js';
import * as k2 from './k2.js';
import * as pdms from './pdms.js';
import * as secil from './secil.js';

const PARSERS = [
  { name: 'pdms', mod: pdms },
  { name: 'dh', mod: dh },
  { name: 'k2', mod: k2 },
  { name: 'activa', mod: activa },
  { name: 'secil', mod: secil },
];

export function dispatch(text) {
  for (const p of PARSERS) {
    if (p.mod.detect(text)) {
      const result = p.mod.parse(text);
      if (!result) continue;
      if (result.multi) {
        return result.orders.map((o) => ({ ...o, source: o.source || p.name }));
      }
      return [result];
    }
  }
  return [];
}

export { activa, dh, k2, pdms, secil };
