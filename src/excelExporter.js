import { HEADER_ROW, buildRow } from './buildRow.js';

const COL_WIDTH = 28.875;

export function buildAOA(orders) {
  const aoa = [HEADER_ROW()];
  orders.forEach((order, i) => {
    aoa.push(buildRow(order, i));
  });
  return aoa;
}

export function buildWorkbook(orders, XLSX) {
  const aoa = buildAOA(orders);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = aoa[0].map(() => ({ wch: COL_WIDTH }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
}

export function exportToBlob(orders, XLSX) {
  const wb = buildWorkbook(orders, XLSX);
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function buildFileName(count, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `FedEx_Batch_${y}-${m}-${d}_${count}shipments.xlsx`;
}
