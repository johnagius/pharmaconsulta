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
};

function abbr(name) {
  const key = String(name || '').trim().toLowerCase();
  return STATE_ABBR[key] || String(name || '').trim().toUpperCase();
}

export function detect(text) {
  return /PRESCRIPTION/i.test(text) && /Patient Details:/i.test(text);
}

function findValueAfter(text, label) {
  const sameLine = new RegExp(`^\\s*${label}\\s{2,}([^\\n]+)$`, 'im');
  const m1 = text.match(sameLine);
  if (m1 && m1[1].trim()) return m1[1].trim();
  const nextLines = new RegExp(`${label}\\s*\\n+\\s*([^\\n]+)`, 'i');
  const m2 = text.match(nextLines);
  return m2 ? m2[1].trim() : '';
}

function parseAddress(addressLine) {
  const united = addressLine.replace(/\s*United States\s*$/i, '').trim();

  let m = united.match(/^(.+),\s*([^,]+),\s*([^,]+)\s+([0-9]{5}(?:-[0-9]{4})?)$/);
  if (m) {
    return { line1: m[1].trim(), city: m[2].trim(), state: abbr(m[3]), postcode: m[4] };
  }
  m = united.match(/^(.+),\s*(.+?)\s+([A-Z]{2})\s+([0-9]{5}(?:-[0-9]{4})?)$/);
  if (m) {
    return { line1: m[1].trim(), city: m[2].trim(), state: m[3], postcode: m[4] };
  }
  return { line1: united, city: '', state: '', postcode: '' };
}

export function parse(text) {
  if (!detect(text)) return null;
  const t = text;

  const name = findValueAfter(t, /Name/.source);
  const addressLine = findValueAfter(t, /Address/.source);
  const phone = findValueAfter(t, /Phone/.source).replace(/[^0-9+]/g, '');
  const drugMatch = t.match(/Drug Name:\s*Brand \(Generic\)\s*\n+\s*([^\n]+)/i);
  const productText = drugMatch ? drugMatch[1].trim() : '';

  const addr = parseAddress(addressLine);

  return {
    source: 'pdms',
    orderId: '',
    recipient: {
      name,
      line1: addr.line1,
      line2: '',
      city: addr.city,
      state: addr.state,
      postcode: addr.postcode,
      country: 'US',
      phone,
      email: '',
    },
    productText,
    rawText: t,
  };
}
