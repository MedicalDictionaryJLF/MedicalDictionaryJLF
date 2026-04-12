export function parseCSVLines(text) {
  const source = String(text || "");
  const rows = [];
  let cur = [];
  let curField = "";
  let inQuotes = false;

  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = semiCount > commaCount ? ";" : ",";

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (inQuotes) {
      if (ch === "\"") {
        if (next === "\"") {
          curField += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        curField += ch;
      }
    } else if (ch === "\"") {
      inQuotes = true;
    } else if (ch === delimiter) {
      cur.push(curField);
      curField = "";
    } else if (ch === "\r") {
      continue;
    } else if (ch === "\n") {
      cur.push(curField);
      rows.push(cur);
      cur = [];
      curField = "";
    } else {
      curField += ch;
    }
  }

  if (curField !== "" || cur.length > 0) {
    cur.push(curField);
    rows.push(cur);
  }
  return rows;
}

export function rowsToObjects(rows) {
  if (!rows || rows.length === 0) return [];
  const headers = rows[0].map((header) => String(header || "").replace(/^\uFEFF/, "").trim());
  const objects = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const obj = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      obj[headers[columnIndex]] = String(row[columnIndex] || "").trim();
    }
    objects.push(obj);
  }
  return objects;
}

export function rowsToObjectsWithHeaders(rows) {
  if (!rows || rows.length === 0) return { headers: [], objects: [] };
  const headers = rows[0].map((header) => String(header || "").replace(/^\uFEFF/, "").trim());
  const objects = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const obj = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      obj[headers[columnIndex]] = String(row[columnIndex] || "").trim();
    }
    objects.push(obj);
  }
  return { headers, objects };
}
