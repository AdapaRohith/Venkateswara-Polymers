import * as XLSX from 'xlsx'

/**
 * Export data rows to an Excel (.xlsx) file and trigger a browser download.
 *
 * @param {Object} options
 * @param {string}        options.filename   – download file name (without extension)
 * @param {Array<Object>} options.rows       – data rows (array of plain objects)
 * @param {Array<{key:string, label:string}>} options.columns – column definitions
 * @param {Array<Object>} [options.totalRow] – optional totals row to append at the bottom
 * @param {string}        [options.sheetName] – worksheet tab name (default "Sheet1")
 */
export function exportSingleSheet({ filename, rows, columns, totalRow, sheetName = 'Sheet1' }) {
  const headers = columns.map((c) => c.label)
  const data = rows.map((row) =>
    columns.map((col) => {
      const val = row[col.key]
      // Keep numbers as numbers for Excel
      const num = Number(val)
      if (val !== '' && val !== null && val !== undefined && Number.isFinite(num)) return num
      return val ?? ''
    }),
  )

  if (totalRow) {
    data.push(
      columns.map((col) => {
        const val = totalRow[col.key]
        const num = Number(val)
        if (val !== '' && val !== null && val !== undefined && Number.isFinite(num)) return num
        return val ?? ''
      }),
    )
  }

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data])

  // Auto-size columns
  ws['!cols'] = columns.map((col, i) => {
    let maxLen = col.label.length
    for (const row of data) {
      const cellLen = String(row[i] ?? '').length
      if (cellLen > maxLen) maxLen = cellLen
    }
    return { wch: Math.min(maxLen + 4, 50) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

/**
 * Export multiple sheets into one Excel workbook.
 *
 * @param {Object} options
 * @param {string} options.filename – download file name (without extension)
 * @param {Array<{sheetName:string, rows:Array<Object>, columns:Array<{key:string,label:string}>, totalRow?:Object}>} options.sheets
 */
export function exportMultiSheet({ filename, sheets }) {
  const wb = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const headers = sheet.columns.map((c) => c.label)
    const data = sheet.rows.map((row) =>
      sheet.columns.map((col) => {
        const val = row[col.key]
        const num = Number(val)
        if (val !== '' && val !== null && val !== undefined && Number.isFinite(num)) return num
        return val ?? ''
      }),
    )

    if (sheet.totalRow) {
      data.push(
        sheet.columns.map((col) => {
          const val = sheet.totalRow[col.key]
          const num = Number(val)
          if (val !== '' && val !== null && val !== undefined && Number.isFinite(num)) return num
          return val ?? ''
        }),
      )
    }

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data])

    // Auto-size columns
    ws['!cols'] = sheet.columns.map((col, i) => {
      let maxLen = col.label.length
      for (const row of data) {
        const cellLen = String(row[i] ?? '').length
        if (cellLen > maxLen) maxLen = cellLen
      }
      return { wch: Math.min(maxLen + 4, 50) }
    })

    XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName.slice(0, 31))
  }

  XLSX.writeFile(wb, `${filename}.xlsx`)
}
