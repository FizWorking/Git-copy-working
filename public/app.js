const ENDPOINT = window.location.origin;

const FIELD_CONFIGS = {
  customer: {
    endpoint: '/add_customer',
    label: 'Customer',
    fields: [
      { key: 'name', label: 'Name *', required: true },
      { key: 'email', label: 'Email', required: false },
      { key: 'phone', label: 'Phone', required: false },
      { key: 'address1', label: 'Address Line 1', required: false },
      { key: 'address2', label: 'Address Line 2', required: false },
      { key: 'city', label: 'City', required: false },
      { key: 'state', label: 'State', required: false },
      { key: 'zipcode', label: 'Zip Code', required: false },
      { key: 'country', label: 'Country', required: false }
    ]
  },
  vendor: {
    endpoint: '/add_vendor',
    label: 'Vendor',
    fields: [
      { key: 'name', label: 'Name *', required: true },
      { key: 'email', label: 'Email', required: false },
      { key: 'phone', label: 'Phone', required: false },
      { key: 'street1', label: 'Street 1', required: false },
      { key: 'street2', label: 'Street 2', required: false },
      { key: 'city', label: 'City', required: false },
      { key: 'state', label: 'State', required: false },
      { key: 'zipcode', label: 'Zip Code', required: false },
      { key: 'country', label: 'Country', required: false },
      { key: 'sysid', label: 'Vendor ID (sysid)', required: false }
    ]
  },
  bill: {
    endpoint: '/add_bill_to_purchase_order',
    label: 'Bill',
    fields: [
      { key: 'po_id', label: 'PO Number (id) *', required: true },
      { key: 'sku', label: 'Item SKU *', required: true },
      { key: 'quantity', label: 'Quantity *', required: true },
      { key: 'transaction_date', label: 'Transaction Date', required: false }
    ]
  }
};

let parsedData = [];
let currentEntity = '';
let headerRow = [];

document.getElementById('entityType').addEventListener('change', function() {
  currentEntity = this.value;
  const infoBox = document.getElementById('fieldInfo');
  const previewSection = document.getElementById('previewSection');
  const submitSection = document.getElementById('submitSection');

  previewSection.style.display = 'none';
  submitSection.style.display = 'none';
  document.getElementById('results').innerHTML = '';

  if (!currentEntity) {
    infoBox.textContent = '';
    return;
  }

  const config = FIELD_CONFIGS[currentEntity];
  const requiredFields = config.fields.filter(f => f.required).map(f => f.label).join(', ');
  infoBox.innerHTML = `<strong>${config.label}</strong> endpoint: <code>${config.endpoint}</code><br>
    Required fields: ${requiredFields}`;
});

document.getElementById('fileInput').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const status = document.getElementById('uploadStatus');
  status.textContent = 'Reading file...';

  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const data = new Uint8Array(ev.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!json.length) {
        status.className = 'status-msg error-msg';
        status.textContent = 'Excel file is empty.';
        return;
      }

      headerRow = Object.keys(json[0]);
      parsedData = json;
      status.className = 'status-msg success-msg';
      status.textContent = `Loaded ${json.length} rows with ${headerRow.length} columns.`;
      showPreview();
    } catch (err) {
      status.className = 'status-msg error-msg';
      status.textContent = 'Error reading file: ' + err.message;
    }
  };
  reader.readAsArrayBuffer(file);
});

function showPreview() {
  if (!currentEntity) {
    alert('Please select a data type first.');
    return;
  }

  const config = FIELD_CONFIGS[currentEntity];
  const container = document.getElementById('mappingContainer');
  const wrapper = document.getElementById('tableWrapper');

  let mappingHtml = '<div class="mapping-row"><span class="label">Excel Column</span><span class="label">Map to Field</span></div>';
  mappingHtml += '<div class="mapping-row"><span class="label">(skip row)</span><span class="label"><select class="field-select skip-option"><option value="">-- Skip --</option></select></span></div>';

  headerRow.forEach(col => {
    const autoMatch = config.fields.find(f => f.key.toLowerCase() === col.toLowerCase().replace(/[^a-z0-9]/gi, ''));
    mappingHtml += `<div class="mapping-row">
      <span class="label">${col}</span>
      <select class="field-select" data-col="${col}">
        <option value="">-- Skip --</option>
        ${config.fields.map(f =>
          `<option value="${f.key}" ${autoMatch && autoMatch.key === f.key ? 'selected' : ''}>${f.label}</option>`
        ).join('')}
      </select>
    </div>`;
  });

  container.innerHTML = mappingHtml;

  let tableHtml = '<table><thead><tr>';
  tableHtml += '<th>#</th>';
  headerRow.forEach(col => { tableHtml += `<th>${col}</th>`; });
  tableHtml += '</tr></thead><tbody>';

  const previewRows = parsedData.slice(0, 20);
  previewRows.forEach((row, idx) => {
    tableHtml += '<tr>';
    tableHtml += `<td>${idx + 1}</td>`;
    headerRow.forEach(col => { tableHtml += `<td>${String(row[col]).substring(0, 50)}</td>`; });
    tableHtml += '</tr>';
  });

  if (parsedData.length > 20) {
    tableHtml += `<tr><td colspan="${headerRow.length + 1}" style="text-align:center;color:#7f8c8d">... and ${parsedData.length - 20} more rows</td></tr>`;
  }

  tableHtml += '</tbody></table>';
  wrapper.innerHTML = tableHtml;

  document.getElementById('previewSection').style.display = 'block';
  document.getElementById('submitSection').style.display = 'block';
  document.getElementById('results').innerHTML = '';
}

document.getElementById('submitBtn').addEventListener('click', async function() {
  if (!currentEntity || !parsedData.length) return;

  const config = FIELD_CONFIGS[currentEntity];
  const selects = document.querySelectorAll('.field-select:not(.skip-option)');
  const mapping = {};

  selects.forEach(sel => {
    if (sel.value) {
      mapping[sel.value] = sel.dataset.col;
    }
  });

  const requiredFields = config.fields.filter(f => f.required);
  const missing = requiredFields.filter(f => !mapping[f.key]);
  if (missing.length) {
    alert('Please map all required fields: ' + missing.map(f => f.label).join(', '));
    return;
  }

  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Sending...';

  const progressBar = document.getElementById('progress');
  const progressFill = document.getElementById('progressFill');
  const resultsDiv = document.getElementById('results');
  progressBar.style.display = 'block';
  resultsDiv.innerHTML = '';

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < parsedData.length; i++) {
    const row = parsedData[i];
    const payload = buildPayload(currentEntity, row, mapping, config);

    try {
      const res = await fetch(ENDPOINT + config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = await res.text();

      if (res.ok) {
        successCount++;
        resultsDiv.innerHTML += `<div class="result-item success"><span class="row-num">Row ${i + 1}:</span> <span class="msg">✓ ${text}</span></div>`;
      } else {
        failCount++;
        resultsDiv.innerHTML += `<div class="result-item error"><span class="row-num">Row ${i + 1}:</span> <span class="msg">✗ ${text}</span></div>`;
      }
    } catch (err) {
      failCount++;
      resultsDiv.innerHTML += `<div class="result-item error"><span class="row-num">Row ${i + 1}:</span> <span class="msg">✗ ${err.message}</span></div>`;
    }

    progressFill.style.width = `${((i + 1) / parsedData.length) * 100}%`;
  }

  btn.disabled = false;
  btn.textContent = 'Send to QuickBooks';

  resultsDiv.innerHTML += `<div class="result-item ${failCount === 0 ? 'success' : 'error'}" style="font-weight:600">
    Done: ${successCount} succeeded, ${failCount} failed out of ${parsedData.length} rows.
  </div>`;
});

function buildPayload(entity, row, mapping, config) {
  const getVal = (key) => {
    const col = mapping[key];
    return col ? row[col] : '';
  };

  if (entity === 'customer') {
    return {
      customer: {
        name: getVal('name'),
        email: getVal('email'),
        phone: getVal('phone'),
        billing_address: {
          address1: getVal('address1'),
          address2: getVal('address2'),
          city: getVal('city'),
          state: getVal('state'),
          country: getVal('country'),
          zipcode: getVal('zipcode')
        }
      },
      parameters: {}
    };
  }

  if (entity === 'vendor') {
    return {
      vendor: {
        name: getVal('name'),
        email: getVal('email'),
        phone: getVal('phone'),
        street1: getVal('street1'),
        street2: getVal('street2'),
        city: getVal('city'),
        state: getVal('state'),
        country: getVal('country'),
        zipcode: getVal('zipcode'),
        sysid: getVal('sysid')
      },
      parameters: {}
    };
  }

  if (entity === 'bill') {
    return {
      purchase_order: {
        id: getVal('po_id'),
        transaction_date: getVal('transaction_date') || undefined,
        received_items: [
          {
            sku: getVal('sku'),
            quantity: parseFloat(getVal('quantity')) || 0
          }
        ]
      },
      bill: {},
      parameters: {}
    };
  }

  return {};
}
