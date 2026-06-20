const ImportPage = {
  step: 1, connections: [], fileData: null, mapping: {}, defaults: {},
  importResult: null, isImporting: false,

  async init() {
    App.setActiveNav('import');
    this.step = 1; this.fileData = null; this.mapping = {}; this.defaults = {}; this.importResult = null; this.isImporting = false;
    try {
      this.connections = await API.getConnections();
      this.renderStep1();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  steps() {
    const labels = ['Setup', 'Upload & Map', 'Import', 'Results'];
    const cur = this.importResult ? 4 : this.fileData ? 3 : this.step === 2 ? 2 : 1;
    return `<div class="steps">${labels.map((l, i) => `<div class="step ${i+1 === cur ? 'active' : i+1 < cur ? 'done' : ''}">${l}</div>`).join('')}</div>`;
  },

  renderStep1() {
    const c = document.getElementById('pageContent');
    c.innerHTML = `
      ${this.steps()}
      <div class="card">
        <div class="card-title">Import Setup</div>
        <div class="card-subtitle">Choose QuickBooks company and transaction type.</div>
        <div class="form-group">
          <label>QuickBooks Company</label>
          <select id="connSelect">
            ${this.connections.length === 0 ? '<option value="">-- No connections --</option>' : this.connections.map(co => `<option value="${co.id}">${esc(co.company_name)}</option>`).join('')}
          </select>
          ${this.connections.length === 0 ? '<p style="font-size:12px;color:var(--danger);margin-top:4px">No QBO connection. <a href="#/dashboard" style="color:var(--primary)">Connect first</a> or use manual mode below.</p>' : ''}
        </div>
        <div class="form-group">
          <label>Transaction Type</label>
          <select id="typeSelect">
            <option value="Customer">Customer</option>
            <option value="Vendor">Vendor</option>
            <option value="Bill">Bill (from Purchase Order)</option>
          </select>
        </div>
        <hr style="border:none;border-top:1px solid var(--gray-200);margin:20px 0">
        <div class="card-title" style="font-size:15px">Or use Manual Tokens (no OAuth needed)</div>
        <div class="defaults-grid">
          <div class="form-group"><label>Access Token</label><input type="text" id="manualAccessToken" placeholder="QuickBooks access token"></div>
          <div class="form-group"><label>Refresh Token</label><input type="text" id="manualRefreshToken" placeholder="QuickBooks refresh token"></div>
          <div class="form-group"><label>Realm ID</label><input type="text" id="manualRealmId" placeholder="QuickBooks company ID"></div>
          <div class="form-group"><label><input type="checkbox" id="manualSandbox"> Sandbox mode</label></div>
        </div>
        <button class="btn btn-primary btn-lg mt-16" onclick="ImportPage.goStep2()">Next: Upload File</button>
      </div>`;
  },

  goStep2() {
    this.connectionId = parseInt(document.getElementById('connSelect')?.value) || null;
    this.transactionType = document.getElementById('typeSelect').value;
    this.manualTokens = {
      access_token: document.getElementById('manualAccessToken')?.value?.trim() || '',
      refresh_token: document.getElementById('manualRefreshToken')?.value?.trim() || '',
      realm_id: document.getElementById('manualRealmId')?.value?.trim() || '',
      sandbox: document.getElementById('manualSandbox')?.checked || false
    };
    this.step = 2;
    this.renderStep2();
  },

  renderStep2() {
    const c = document.getElementById('pageContent');
    c.innerHTML = `
      ${this.steps()}
      <div class="card">
        <div class="card-title">Upload File</div>
        <div class="card-subtitle">Upload Excel (.xlsx/.xls) or CSV file.</div>
        <div class="upload-zone" id="uploadZone">
          <div class="upload-zone-icon">&#128196;</div>
          <div class="upload-zone-text">Drag & drop or click to browse</div>
          <div class="upload-zone-hint">Supports .xlsx, .xls, .csv</div>
          <div id="uploadFileName" class="upload-file-name"></div>
          <input type="file" id="fileInput" accept=".xlsx,.xls,.csv">
        </div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button class="btn btn-outline" onclick="ImportPage.init()">Back</button>
          <button class="btn btn-primary" id="parseBtn" onclick="ImportPage.parseFile()">Parse File</button>
        </div>
        <div id="parseStatus" style="margin-top:12px"></div>
      </div>
      <div id="previewArea" style="display:none">
        <div class="card"><div class="card-title">Preview &amp; Map Columns</div>
        <div id="mappingArea"></div></div>
        <div class="card"><div class="card-title">Default Values</div>
        <div class="defaults-grid" id="defaultsArea"></div>
        <button class="btn btn-success btn-lg mt-16" onclick="ImportPage.execute()">Import to QuickBooks</button>
        <div id="importProgress"></div></div>
      </div>`;

    const zone = document.getElementById('uploadZone');
    const input = document.getElementById('fileInput');
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragover'); if (e.dataTransfer.files.length) this.setFile(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files.length) this.setFile(input.files[0]); });
  },

  setFile(file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) { App.toast('Please select Excel or CSV', 'error'); return; }
    this.selectedFile = file;
    document.getElementById('uploadFileName').textContent = file.name;
    document.getElementById('uploadZone').classList.add('has-file');
  },

  parseFile() {
    if (!this.selectedFile) { App.toast('Select a file first', 'error'); return; }
    const status = document.getElementById('parseStatus');
    status.textContent = 'Parsing...';

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!json.length) { status.textContent = 'File is empty'; return; }

        this.parsedData = json;
        this.columns = Object.keys(json[0]);
        this.autoMap();
        this.renderPreview();
        status.innerHTML = '<span style="color:var(--success)">Loaded ' + json.length + ' rows</span>';
      } catch (e) { status.innerHTML = '<span style="color:var(--danger)">Error: ' + e.message + '</span>'; }
    };
    reader.readAsArrayBuffer(this.selectedFile);
  },

  autoMap() {
    const maps = {
      name: ['name', 'customer name', 'vendor name', 'display name', 'full name'],
      email: ['email', 'e-mail', 'email address'],
      phone: ['phone', 'telephone', 'phone number', 'contact'],
      address1: ['address1', 'address', 'street1', 'street', 'line1'],
      address2: ['address2', 'street2', 'line2'],
      city: ['city', 'town'],
      state: ['state', 'province', 'region'],
      zipcode: ['zipcode', 'zip', 'postcode', 'postal code'],
      country: ['country'],
      street1: ['street1', 'street', 'address1', 'address'],
      po_id: ['po id', 'po number', 'purchase order', 'order id', 'id'],
      sku: ['sku', 'item', 'item sku', 'product', 'product code'],
      quantity: ['quantity', 'qty', 'count']
    };
    this.mapping = {};
    this.columns.forEach(col => {
      const lower = col.toLowerCase().trim();
      for (const [field, aliases] of Object.entries(maps)) {
        if (aliases.some(a => lower === a || lower.includes(a))) { this.mapping[field] = col; break; }
      }
    });
  },

  renderPreview() {
    document.getElementById('previewArea').style.display = 'block';
    const type = this.transactionType;
    const fields = type === 'Customer'
      ? ['name','email','phone','address1','address2','city','state','zipcode','country']
      : type === 'Vendor'
      ? ['name','email','phone','street1','city','state','zipcode','country']
      : ['po_id','sku','quantity'];

    const fieldLabels = { name:'Name', email:'Email', phone:'Phone', address1:'Address 1', address2:'Address 2', city:'City', state:'State', zipcode:'Zip', country:'Country', street1:'Street', po_id:'PO Number', sku:'SKU', quantity:'Quantity' };

    let html = '<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table><thead><tr><th>#</th>' + this.columns.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>';
    this.parsedData.slice(0, 15).forEach((row, i) => {
      html += '<tr><td>' + (i+1) + '</td>' + this.columns.map(c => '<td>' + esc(row[c]) + '</td>').join('') + '</tr>';
    });
    if (this.parsedData.length > 15) html += '<tr><td colspan="' + (this.columns.length+1) + '" style="text-align:center;color:var(--gray-400)">... and ' + (this.parsedData.length - 15) + ' more rows</td></tr>';
    html += '</tbody></table></div>';

    html += '<div class="card-subtitle mt-16">Map columns to QuickBooks fields:</div>';
    this.columns.forEach(col => {
      const matched = Object.entries(this.mapping).find(([,v]) => v === col);
      html += '<div class="mapping-row"><div class="mapping-col-name">' + esc(col) + '</div><div class="mapping-select"><select class="map-select" data-col="' + esc(col) + '"><option value="">-- Skip --</option>' + fields.map(f => '<option value="' + f + '" ' + (matched && matched[0] === f ? 'selected' : '') + '>' + (fieldLabels[f] || f) + '</option>').join('') + '</select></div></div>';
    });
    document.getElementById('mappingArea').innerHTML = html;

    document.querySelectorAll('.map-select').forEach(sel => {
      sel.addEventListener('change', () => this.updateMapping());
    });

    let defs = '';
    if (type === 'Customer') {
    } else if (type === 'Vendor') {
    } else if (type === 'Bill') {
      defs += '<div class="form-group"><label>Transaction Date</label><input type="date" id="defDate"></div>';
    }
    document.getElementById('defaultsArea').innerHTML = defs;
  },

  updateMapping() {
    this.mapping = {};
    document.querySelectorAll('.map-select').forEach(sel => {
      if (sel.value) this.mapping[sel.value] = sel.dataset.col;
    });
  },

  async execute() {
    if (this.isImporting) return;
    this.isImporting = true;

    const missing = this.transactionType === 'Customer' ? ['name'] : this.transactionType === 'Vendor' ? ['name'] : ['po_id', 'sku', 'quantity'];
    const unMapped = missing.filter(f => !this.mapping[f]);
    if (unMapped.length) { App.toast('Map required fields: ' + unMapped.join(', '), 'error'); this.isImporting = false; return; }

    const btn = event.target;
    btn.disabled = true;
    btn.textContent = 'Importing...';

    const defaults = { date: document.getElementById('defDate')?.value || '' };
    const resultsDiv = document.getElementById('importProgress');
    resultsDiv.innerHTML = '<div class="progress-bar"><div class="progress-fill" id="progFill" style="width:0"></div></div>';

    let success = 0, errors = 0;
    const total = this.parsedData.length;

    for (let i = 0; i < total; i++) {
      const row = this.parsedData[i];
      const payload = this.buildPayload(row);
      const qboParams = this.manualTokens.access_token
        ? { quickbooks_access_token: this.manualTokens.access_token, quickbooks_access_secret: this.manualTokens.refresh_token, quickbooks_realm: this.manualTokens.realm_id, quickbooks_sandbox: this.manualTokens.sandbox ? '1' : undefined }
        : {};

      const endpoint = this.transactionType === 'Customer' ? '/add_customer' : this.transactionType === 'Vendor' ? '/add_vendor' : '/add_bill_to_purchase_order';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, parameters: qboParams })
        });
        const text = await res.text();
        if (res.ok) { success++; resultsDiv.innerHTML += '<div style="color:var(--success);font-size:13px">Row ' + (i+1) + ': OK</div>'; }
        else { errors++; resultsDiv.innerHTML += '<div style="color:var(--danger);font-size:13px">Row ' + (i+1) + ': ' + esc(text) + '</div>'; }
      } catch (e) { errors++; resultsDiv.innerHTML += '<div style="color:var(--danger);font-size:13px">Row ' + (i+1) + ': ' + e.message + '</div>'; }

      document.getElementById('progFill').style.width = ((i+1)/total*100) + '%';
    }

    btn.disabled = false;
    btn.textContent = 'Import to QuickBooks';

    resultsDiv.innerHTML += '<div style="font-weight:600;margin-top:12px;padding:12px;background:' + (errors === 0 ? 'var(--success-bg)' : 'var(--danger-bg)') + ';border-radius:6px">Done: ' + success + ' succeeded, ' + errors + ' failed out of ' + total + ' rows.</div>';
    this.isImporting = false;
  },

  buildPayload(row) {
    const val = (f) => { const col = this.mapping[f]; return col ? row[col] : ''; };
    const type = this.transactionType;

    if (type === 'Customer') {
      return { customer: { name: val('name'), email: val('email'), phone: val('phone'), billing_address: { address1: val('address1'), address2: val('address2'), city: val('city'), state: val('state'), country: val('country'), zipcode: val('zipcode') } } };
    }
    if (type === 'Vendor') {
      return { vendor: { name: val('name'), email: val('email'), phone: val('phone'), street1: val('street1'), city: val('city'), state: val('state'), country: val('country'), zipcode: val('zipcode') } };
    }
    if (type === 'Bill') {
      return { purchase_order: { id: val('po_id'), received_items: [{ sku: val('sku'), quantity: parseFloat(val('quantity')) || 0 }], transaction_date: document.getElementById('defDate')?.value || '' }, bill: {} };
    }
    return {};
  }
};

window.ImportPage = ImportPage;
