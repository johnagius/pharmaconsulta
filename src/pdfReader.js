export async function readPdfText(file, pdfjsLib) {
  const buf = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(renderPage(content));
  }
  return pages.join('\n');
}

function renderPage(content) {
  const lines = new Map();
  for (const item of content.items) {
    if (!item.str) continue;
    const y = Math.round(item.transform[5]);
    const x = item.transform[4];
    const w = item.width || 0;
    const entry = lines.get(y) || [];
    entry.push({ x, w, str: item.str, hasEOL: item.hasEOL });
    lines.set(y, entry);
  }
  const keys = Array.from(lines.keys()).sort((a, b) => b - a);
  const rows = keys.map((y) => {
    const items = lines.get(y).sort((a, b) => a.x - b.x);
    let line = '';
    let prevEnd = null;
    let avgCharWidth = 5;
    for (const it of items) {
      if (it.w && it.str.length) {
        avgCharWidth = Math.max(2, it.w / it.str.length);
      }
      if (prevEnd !== null) {
        const gap = it.x - prevEnd;
        if (gap > avgCharWidth * 0.6) {
          const spaces = Math.max(1, Math.min(20, Math.round(gap / avgCharWidth)));
          line += ' '.repeat(spaces);
        }
      }
      line += it.str;
      prevEnd = it.x + (it.w || it.str.length * avgCharWidth);
    }
    return line.replace(/[ \t]+/g, ' ').trim();
  });
  return rows.filter((l) => l.length).join('\n');
}
