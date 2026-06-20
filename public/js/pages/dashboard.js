const DashboardPage = {
  init(params) {
    App.setActiveNav('dashboard');
    this.render();
    if (params.qbo === 'connected') App.toast('QuickBooks connected successfully!', 'success');
    if (params.error) App.toast(params.error, 'error');
  },

  async render() {
    const c = document.getElementById('pageContent');
    c.innerHTML = '<h2>Loading dashboard...</h2>';

    try {
      const [connections, history] = await Promise.all([API.getConnections(), API.getHistory()]);
      const totalImports = history.length;
      const totalTransactions = history.reduce((s, r) => s + (r.success_count || 0), 0);

      c.innerHTML = `
        <h2>QB Bulk Importer</h2>
        <p style="color:var(--gray-500);margin-bottom:24px;">Import Excel/CSV data into QuickBooks Online</p>
        <div class="stats">
          <div class="stat-card"><div class="stat-value">${connections.length}</div><div class="stat-label">Connected Companies</div></div>
          <div class="stat-card"><div class="stat-value">${totalImports}</div><div class="stat-label">Total Imports</div></div>
          <div class="stat-card"><div class="stat-value">${totalTransactions}</div><div class="stat-label">Records Imported</div></div>
        </div>
        <div class="card">
          <div class="flex items-center justify-between">
            <div class="card-title">QuickBooks Connections</div>
            <button class="btn btn-primary btn-sm" onclick="DashboardPage.connectQBO()">+ Connect New</button>
          </div>
          ${connections.length === 0 ? `
            <div class="empty-state">
              <p style="margin-bottom:12px">No QuickBooks companies connected yet.</p>
              <button class="btn btn-primary" onclick="DashboardPage.connectQBO()">Connect to QuickBooks</button>
              <p style="margin-top:12px;font-size:12px;color:var(--gray-400)">
                Or use <a href="#/import" style="color:var(--primary)">Import</a> with manual tokens
              </p>
            </div>
          ` : connections.map(co => `
            <div class="conn-item">
              <div><div class="conn-name">${esc(co.company_name)}</div><div class="conn-date">Connected: ${new Date(co.connected_at).toLocaleDateString()}</div></div>
              <div><button class="btn btn-sm btn-outline" onclick="DashboardPage.disconnect(${co.id})">Disconnect</button></div>
            </div>
          `).join('')}
        </div>
        <div class="card">
          <div class="flex items-center justify-between">
            <div class="card-title">Recent Imports</div>
            <a href="#/history" class="btn btn-sm btn-outline">View All</a>
          </div>
          ${history.length === 0 ? '<div class="empty-state"><p>No imports yet. <a href="#/import" style="color:var(--primary)">Import your first file</a></p></div>' : `
            <div class="table-wrap"><table><thead><tr><th>Date</th><th>File</th><th>Company</th><th>Type</th><th>Success</th><th>Status</th></tr></thead><tbody>
            ${history.slice(0, 10).map(r => `<tr><td>${new Date(r.created_at).toLocaleDateString()}</td><td>${esc(r.file_name || '-')}</td><td>${esc(r.company_name || '-')}</td><td>${esc(r.transaction_type || '-')}</td><td style="color:var(--success);font-weight:600">${r.success_count}/${r.total_rows}</td><td><span class="badge ${r.status === 'completed' ? 'badge-success' : r.status === 'partial' ? 'badge-warning' : 'badge-danger'}">${r.status}</span></td></tr>`).join('')}
            </tbody></table></div>`}
        </div>`;
    } catch (e) {
      c.innerHTML = `<div class="empty-state"><p style="color:var(--danger)">Error: ${e.message}</p></div>`;
    }
  },

  async connectQBO() {
    try {
      const result = await API.getQboAuthUrl();
      window.location.href = result.authUrl;
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async disconnect(id) {
    if (!confirm('Disconnect this QuickBooks company?')) return;
    try { await API.disconnectConnection(id); App.toast('Disconnected', 'success'); this.render(); }
    catch (e) { App.toast(e.message, 'error'); }
  }
};

window.DashboardPage = DashboardPage;
