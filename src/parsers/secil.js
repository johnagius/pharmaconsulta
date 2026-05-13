const CITY_STATE_ZIP_COMMA = /^([^,]+),\s*([A-Z]{2})[,]?\s*([0-9]{5}(?:-[0-9]{4})?)$/;
const CITY_STATE_ZIP_SPACES = /^([^,]+?)\s+([A-Z]{2})\s+([0-9]{5}(?:-[0-9]{4})?)$/;
const STATE_FULL = {
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

export function detect(text) {
  if (/Products Ordered:/i.test(text) && /^Order/im.test(text) && !/A-Stock/i.test(text)) {
    return true;
  }
  return false;
}

function isPhone(line) {
  const cleaned = line.replace(/[^0-9+]/g, '');
  return /^\+?\d{10,}$/.test(cleaned);
}
function isEmail(line) {
  return /\S+@\S+\.\S+/.test(line);
}
function isDate(line) {
  return /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(line.trim());
}
function isOrderHeader(line) {
  return /^Orders?[\s-]\d+/i.test(line.trim());
}

function tryCityStateZip(raw) {
  const noTrailingComma = raw.replace(/,\s*$/, '');
  let m = noTrailingComma.match(CITY_STATE_ZIP_COMMA);
  if (m) return { city: m[1].trim(), state: m[2], postcode: m[3] };
  m = noTrailingComma.match(CITY_STATE_ZIP_SPACES);
  if (m) {
    const zip = m[3].replace(/\s/g, '');
    return { city: m[1].trim(), state: m[2], postcode: zip };
  }
  m = noTrailingComma.match(/^([^,]+),\s*([A-Z]{2})\s+([0-9]{4,5}\s?[0-9]{0,5})$/);
  if (m) return { city: m[1].trim(), state: m[2], postcode: m[3].replace(/\s/g, '') };
  m = noTrailingComma.match(/^([A-Za-z][^,]+),\s*([A-Za-z\s]+)\s+([0-9]{5}(?:-[0-9]{4})?)$/);
  if (m) {
    const stateName = m[2].trim();
    const stateAbbr = STATE_FULL[stateName.toLowerCase()] || stateName.toUpperCase();
    return { city: m[1].trim(), state: stateAbbr, postcode: m[3] };
  }
  return null;
}

export function parse(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const productsIdx = lines.findIndex((l) => /^Products Ordered:/i.test(l));
  if (productsIdx === -1) return null;
  const header = lines.slice(0, productsIdx).filter((l) => l && !isDate(l) && !isOrderHeader(l));

  let name = '', phone = '', email = '', city = '', state = '', zip = '';
  const addressLines = [];
  for (const raw of header) {
    if (isEmail(raw)) { email = raw; continue; }
    if (isPhone(raw)) { phone = raw.replace(/[^0-9+]/g, ''); continue; }
    const csz = tryCityStateZip(raw);
    if (csz) { city = csz.city; state = csz.state; zip = csz.postcode; continue; }
    if (!name) { name = raw; continue; }
    addressLines.push(raw);
  }

  const productLine = lines
    .slice(productsIdx + 1)
    .map((l) => l.replace(/^[•\-\*]\s*/, '').trim())
    .find((l) => !!l) || '';

  return {
    source: 'secil',
    orderId: '',
    recipient: {
      name,
      line1: addressLines[0] || '',
      line2: addressLines[1] || '',
      city,
      state,
      postcode: zip,
      country: 'US',
      phone,
      email,
    },
    productText: productLine,
    rawText: text,
  };
}
