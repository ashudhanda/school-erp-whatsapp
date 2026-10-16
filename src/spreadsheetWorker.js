import {parentPort,workerData} from 'node:worker_threads';
import ExcelJS from 'exceljs';
try {
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(workerData));
  if(workbook.worksheets.length>20)throw new Error('Maximum 20 worksheets.');
  const sheets=workbook.worksheets.filter(s=>s.state==='visible'||!s.state).map(sheet=>{
    if(sheet.rowCount>1001||sheet.columnCount>50)throw new Error('Maximum 1,000 data rows and 50 columns.');
    const rows=[];
    sheet.eachRow({includeEmpty:true},row=>{
      const values=[];
      for(let col=1;col<=sheet.columnCount;col++) {
        const cell=row.getCell(col);if(cell.formula||cell.sharedFormula)throw new Error('Replace formulas with plain values before importing.');
        const value=cell.value;
        if(value instanceof Date)values.push(value.toISOString().slice(0,10));
        else if(value&&typeof value==='object') {if(value.richText)values.push(value.richText.map(t=>t.text).join(''));else throw new Error('Use plain text or numbers, not linked or error cells.');}
        else values.push(String(value??''));
        if(values.at(-1).length>4000)throw new Error('Cell is too long.');
      }
      rows.push(values);
    });
    return {name:sheet.name,rows};
  });
  if(!sheets.length)throw new Error('No visible worksheet.');parentPort.postMessage({sheets});
}catch(error){parentPort.postMessage({error:'Workbook rejected: '+String(error.message).slice(0,160)});}
