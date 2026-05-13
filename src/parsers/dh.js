const CITY_STATE_ZIP = /^([^,]+),\s*([A-Z]{2})\s+([0-9]{5}(?:-[0-9]{4})?)\s*$/;

function normalize(text) {
  return text.replace(/ﬀ|ﬁ|ﬂ|ﬃ|ﬄ|�/g, (ch) => {
    const map = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl' };
    return map[ch] || ch;
  });
}

export function detect(text) {
  return /OrderID:\s*\d+/i.test(text) && /Shipping Address/i.test(text);
}

export function parse(text) {
  const t = normalize(text);
  const idMatch = t.match(/OrderID:\s*(\d+)/i);
  const orderId = idMatch ? idMatch[1] : '';

  const lines = t.split(/\r?\n/).map((l) => l.trim());
  const start = lines.findIndex((l) => /^Shipping Address/i.test(l));
  if (start === -1) return null;

  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (/^Products?\b/i.test(line)) break;
    block.push(line);
  }

  let name = '';
  let line1 = '';
  let city = '';
  let state = '';
  let zip = '';
  let phone = '';
  let email = '';
  const country = 'US';

  for (const raw of block) {
    if (/^USA$|^United States$/i.test(raw)) continue;
    if (/^Phone:/i.test(raw)) {
      phone = raw.replace(/^Phone:\s*/i, '').replace(/[^0-9+]/g, '');
      continue;
    }
    if (/^Email:/i.test(raw)) {
      email = raw.replace(/^Email:\s*/i, '').trim();
      continue;
    }
    const m = raw.match(CITY_STATE_ZIP);
    if (m) {
      city = m[1].trim();
      state = m[2];
      zip = m[3];
      continue;
    }
    if (!name) {
      name = raw;
    } else if (!line1) {
      line1 = raw;
    }
  }

  const productLine = lines
    .slice(lines.findIndex((l) => /^Products?\b/i.test(l)) + 1)
    .find((l) => l && !/^Product Name/i.test(l) && !/^Generated:/i.test(l));
  const productText = productLine ? productLine.replace(/\s{2,}\d+\s*$/, '').trim() : '';

  return {
    source: 'dh',
    orderId,
    recipient: {
      name,
      line1,
      city,
      state,
      postcode: zip,
      country,
      phone,
      email,
    },
    productText,
    rawText: t,
  };
}
