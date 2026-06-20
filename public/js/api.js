function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const API = {
  async request(method, path, data) {
    const opts = {
      method,
      headers: {
        'Authorization': 'Bearer no-auth-required'
      }
    };

    if (data instanceof FormData) {
      opts.body = data;
    } else if (data) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(data);
    }

    const res = await fetch(path, opts);
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Server returned ${res.status}: ${res.statusText}`);
    }
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  },

  get(path) { return this.request('GET', path); },
  post(path, data) { return this.request('POST', path, data); },
  delete(path) { return this.request('DELETE', path); },

  getQboAuthUrl() { return this.get('/api/qbo/auth-url'); },
  getConnections() { return this.get('/api/qbo/connections'); },
  disconnectConnection(id) { return this.delete(`/api/qbo/connections/${id}`); },

  uploadFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = await this.post('/api/import/upload', {
            fileName: file.name,
            fileData: reader.result.split(',')[1]
          });
          resolve(result);
        } catch (e) { reject(e); }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  },
  executeImport(data) { return this.post('/api/import/execute', data); },
  getHistory() { return this.get('/api/import/history'); },
  getHistoryDetail(id) { return this.get(`/api/import/history/${id}`); }
};
