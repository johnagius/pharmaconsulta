const STATE_ABBR = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN',
  texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC', 'puerto rico': 'PR',
};

function abbr(name) {
  const key = String(name || '').trim().toLowerCase();
  return STATE_ABBR[key] || name.trim().toUpperCase();
}

export function detect(text) {
  return /A-Stock\b/i.test(text) && /Shipping Address:/i.test(text);
}

export function parse(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const start = lines.findIndex((l) => /^Shipping Address:/i.test(l));
  if (start === -1) return null;

  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (/^Products Ordered:/i.test(line) || /^\*{5,}/.test(line)) break;
    block.push(line);
  }

  let name = '';
  let line1 = '';
  let line2 = '';
  let city = '';
  let state = '';
  let zip = '';
  let phone = '';
  let buf = [];

  for (const raw of block) {
    if (/^United States$/i.test(raw)) continue;
    if (/^T:/i.test(raw)) {
      phone = raw.replace(/^T:\s*/i, '').replace(/[^0-9+]/g, '');
      continue;
    }
    if (/^\(?\+?\d[\d\s\-().]{7,}$/.test(raw)) {
      phone = raw.replace(/[^0-9+]/g, '');
      continue;
    }
    const cityStateZip = raw.match(/^([^,]+),\s*([^,]+),\s*([0-9]{5}(?:-[0-9]{4})?)$/);
    if (cityStateZip) {
      city = cityStateZip[1].trim();
      state = abbr(cityStateZip[2]);
      zip = cityStateZip[3];
      continue;
    }
    buf.push(raw);
  }

  if (buf.length) name = buf.shift();
  if (buf.length) line1 = buf.shift();
  if (buf.length) line2 = buf.shift();

  const productsIdx = lines.findIndex((l) => /^Products Ordered:/i.test(l));
  const productLine = productsIdx >= 0
    ? (lines.slice(productsIdx + 1).find((l) => l && !/^\*{5,}/.test(l)) || '')
    : '';

  return {
    source: 'activa',
    orderId: '',
    recipient: {
      name,
      line1,
      line2,
      city,
      state,
      postcode: zip,
      country: 'US',
      phone,
      email: '',
    },
    productText: productLine,
    rawText: text,
  };
}
