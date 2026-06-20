require_relative 'lib/qb_integration'
require 'securerandom'
require 'fileutils'

class QuickbooksEndpoint < EndpointBase::Sinatra::Base
  set :logging, true
  set :show_exceptions, false

  QBIntegration::Store.init

  before do
    Honeybadger.context({
      payload: @payload,
      config: @config
    })
  end

  set :public_folder, File.join(File.dirname(__FILE__), 'public')

  get '/' do
    send_file File.join(settings.public_folder, 'index.html')
  end

  # ─── OAuth Routes ───────────────────────────────────────────

  get '/api/qbo/auth-url' do
    state = SecureRandom.hex(16)
    url = QBIntegration::Auth.authorization_url(state)
    content_type :json
    { authUrl: url, state: state }.to_json
  end

  get '/api/qbo/callback' do
    code = params['code']
    realm_id = params['realmId']
    state = params['state']

    unless code && realm_id
      halt 400, 'Missing OAuth parameters'
    end

    begin
      tokens = QBIntegration::Auth.exchange_code_for_tokens(code)
      QBIntegration::Store.insert('qbo_connections', {
        realm_id: realm_id,
        company_id: realm_id,
        company_name: 'QuickBooks Company',
        access_token: tokens[:access_token],
        refresh_token: tokens[:refresh_token]
      })
      redirect '/#/dashboard?qbo=connected'
    rescue => e
      redirect '/#/dashboard?error=oauth_failed'
    end
  end

  # ─── Connections API ────────────────────────────────────────

  get '/api/qbo/connections' do
    conns = QBIntegration::Store.all('qbo_connections').map do |c|
      { id: c['id'], company_id: c['company_id'],
        company_name: c['company_name'], connected_at: c['created_at'] }
    end
    content_type :json
    conns.to_json
  end

  delete '/api/qbo/connections/:id' do
    QBIntegration::Store.delete('qbo_connections', { 'id' => params[:id].to_i })
    content_type :json
    { message: 'Disconnected' }.to_json
  end

  # ─── Import API ─────────────────────────────────────────────

  post '/api/import/upload' do
    unless params[:file] && params[:file][:tempfile]
      halt 400, { error: 'No file uploaded' }.to_json
    end

    ext = File.extname(params[:file][:filename]).downcase
    data = parse_uploaded_file(params[:file][:tempfile], ext)

    file_id = SecureRandom.uuid
    data[:file_name] = params[:file][:filename]
    store_file_data(file_id, data)

    content_type :json
    {
      fileId: file_id,
      fileName: params[:file][:filename],
      columns: data[:columns],
      preview: data[:preview],
      totalRows: data[:totalRows]
    }.to_json
  end

  post '/api/import/execute' do
    body = JSON.parse(request.body.read)
    file_id = body['fileId']
    connection_id = body['connectionId']
    transaction_type = body['transactionType']
    mapping = body['mapping'] || {}
    defaults = body['defaults'] || {}
    date_format = body['dateFormat'] || ''

    unless file_id && connection_id
      halt 400, { error: 'Missing required fields' }.to_json
    end

    cached = read_file_data(file_id)
    unless cached
      halt 400, { error: 'Upload session expired, please re-upload' }.to_json
    end

    connection = QBIntegration::Store.get('qbo_connections', { 'id' => connection_id.to_i })
    unless connection
      halt 404, { error: 'QBO connection not found' }.to_json
    end

    config = build_qbo_config(connection)
    rows = cached[:all_data]
    success = 0
    errors = 0

    imp = QBIntegration::Store.insert('imports', {
      qbo_connection_id: connection_id,
      file_name: cached[:file_name],
      transaction_type: transaction_type,
      total_rows: rows.length,
      success_count: 0,
      error_count: 0,
      status: 'processing'
    })

    rows.each_with_index do |row, i|
      row_num = i + 2
      begin
        payload = build_import_payload(transaction_type, row, mapping, defaults, date_format)
        result = call_qbo_endpoint(transaction_type, payload, config)

        QBIntegration::Store.insert('import_logs', {
          import_id: imp['id'], row_number: row_num,
          status: 'success', qbo_id: result[:qbo_id] || ''
        })
        success += 1
      rescue => e
        QBIntegration::Store.insert('import_logs', {
          import_id: imp['id'], row_number: row_num,
          status: 'error', error_message: e.message
        })
        errors += 1
      end

      if (i + 1) % 10 == 0 || i == rows.length - 1
        QBIntegration::Store.update('imports', { 'id' => imp['id'] },
          { 'success_count' => success, 'error_count' => errors })
      end
    end

    status = errors == 0 ? 'completed' : (success > 0 ? 'partial' : 'failed')
    QBIntegration::Store.update('imports', { 'id' => imp['id'] },
      { 'success_count' => success, 'error_count' => errors, 'status' => status })

    delete_file_data(file_id)

    content_type :json
    { importId: imp['id'], status: status,
      total: rows.length, success: success, errors: errors }.to_json
  end

  get '/api/import/history' do
    list = QBIntegration::Store.all('imports').sort_by { |r| r['created_at'] || '' }.reverse.first(50)
    list = list.map do |r|
      conn = QBIntegration::Store.get('qbo_connections', { 'id' => r['qbo_connection_id'] })
      r.merge('company_name' => conn ? conn['company_name'] : '')
    end
    content_type :json
    list.to_json
  end

  get '/api/import/history/:id' do
    imp = QBIntegration::Store.get('imports', { 'id' => params[:id].to_i })
    halt 404, { error: 'Not found' }.to_json unless imp

    logs = QBIntegration::Store.all('import_logs', { 'import_id' => imp['id'] })
      .sort_by { |l| l['row_number'] }
    conn = QBIntegration::Store.get('qbo_connections', { 'id' => imp['qbo_connection_id'] })
    imp = imp.merge('company_name' => conn ? conn['company_name'] : '', 'logs' => logs)
    content_type :json
    imp.to_json
  end

  # ─── QBO Integration Endpoints ──────────────────────────────

  post '/get_tokens' do
    base_service = QBIntegration::Service::Token.new(@config)
    new_token = base_service.access_token.refresh!

    add_parameter 'access_token', new_token.token
    add_parameter 'refresh_token', new_token.refresh_token

    result 200, "Tokens successfully retrieved"
  end

  post '/validate_token' do
    token = QBIntegration::Service::Token.new(@config)
    if token.valid?
      result 200
    else
      result 401
    end
  end

  post '/add_product' do
    code, summary = QBIntegration::Product.new(@payload, @config).import

    result code, summary
  end

  post '/update_product' do
    code, summary = QBIntegration::Product.new(@payload, @config).import

    result code, summary
  end

  post '/update_product_sku' do
    code, summary, updated_product = QBIntegration::Product.new(@payload, @config).update_sku

    add_object :product, updated_product
    result code, summary
  end

  post '/add_journal' do
    code, summary = QBIntegration::JournalEntry.new(@payload, @config).add

    result code, summary
  end

  post '/update_journal' do
    code, summary = QBIntegration::JournalEntry.new(@payload, @config).update

    result code, summary
  end

  post '/delete_journal' do
    code, summary = QBIntegration::JournalEntry.new(@payload, @config).delete

    result code, summary
  end

  post '/get_orders' do
    orders, summary, new_page_number, since, code = QBIntegration::Order.new(@payload, @config).get
    orders.each do |order|
      add_object :order, order
    end

    result code, summary
  end

  post '/add_order' do
    begin
      code, summary, added_order = QBIntegration::Order.new(@payload, @config).create
      add_object :order, added_order

      result code, summary
    rescue QBIntegration::AlreadyPersistedOrderException => e
      notify_honeybadger e
      result 500, e.message
    end
  end

  post '/add_refund_receipt' do
    begin
      code, summary, added_refund = QBIntegration::RefundReceipt.new(@payload, @config).create

      result code, summary
    rescue QBIntegration::AlreadyPersistedOrderException => e
      result 500, e.message
    end
  end

  post '/add_purchase_order' do
    begin
      code, summary, po = QBIntegration::PurchaseOrder.new(@payload, @config).create
      add_object :purchase_order, po
      result code, summary
    rescue QBIntegration::AlreadyPersistedOrderException => e
      notify_honeybadger e
      result 500, e.message
    end
  end

  post '/update_purchase_order' do
    code, summary = QBIntegration::PurchaseOrder.new(@payload, @config).update

    result code, summary
  end

  post '/add_journal_entry' do
    if @payload['journal_entry']['action'] == "ADD"
      code, summary = QBIntegration::JournalEntry.new(@payload, @config).update
    elsif @payload['journal_entry']['action'] == "UPDATE"
      code, summary = QBIntegration::JournalEntry.new(@payload, @config).update
    elsif @payload['journal_entry']['action'] == "DELETE"
      code, summary = QBIntegration::JournalEntry.new(@payload, @config).delete
    else
      code = 200
      summary = "No Valid Action Given"
    end

    result code, summary
  end

  post '/update_order' do
    code, summary, updated_order = QBIntegration::Order.new(@payload, @config).update

    add_object :order, updated_order
    
    result code, summary
  end

  post '/cancel_order' do
    code, summary = QBIntegration::Order.new(@payload, @config).cancel

    result code, summary
  end

  post '/add_invoice' do
    begin
      code, summary = QBIntegration::Invoice.new(@payload, @config).create

      result code, summary
    rescue QBIntegration::AlreadyPersistedInvoiceException => e
      notify_honeybadger e
      result 500, e.message
    end
  end

  post '/update_invoice' do
    code, summary = QBIntegration::Invoice.new(@payload, @config).update

    result code, summary
  end

  post '/get_invoices' do
    qbo_invoice = QBIntegration::Invoice.new(@payload, @config)
    summary, page, since, code = qbo_invoice.get()
  
    qbo_invoice.invoices.each do |invoice|
      add_object :invoice, qbo_invoice.build_invoice(invoice, @config)
    end
    add_parameter 'quickbooks_page_num', page
    add_parameter 'quickbooks_since', since

    result code, summary
  end

  post '/add_return' do
    code, summary = QBIntegration::ReturnAuthorization.new(@payload, @config).create

    result code, summary
  end

  post '/update_return' do
    code, summary = QBIntegration::ReturnAuthorization.new(@payload, @config).update

    result code, summary
  end

  post '/set_inventory' do
    code, summary = QBIntegration::Stock.new(@payload, @config).set

    result code, summary
  end

  post '/get_vendors' do
    now = Time.now.utc.iso8601

    code, vendors = QBIntegration::Vendor.new(@payload, @config).index
    vendors.each { |vendor| add_object :vendor, vendor }

    new_since = code === 200 ? now : @config.fetch("quickbooks_since")
    add_parameter "quickbooks_since", new_since
    
    add_parameter "page", @config.fetch("page", 1)

    result code, "Retrieved #{vendors.size} vendors"
  end

  post '/add_vendor' do
    code, summary, vendor = QBIntegration::Vendor.new(@payload, @config).create

    add_object :vendor, vendor
    result code, summary
  end

  post '/update_vendor' do
    code, summary, vendor = QBIntegration::Vendor.new(@payload, @config).update

    add_object :vendor, vendor
    result code, summary
  end

  post '/get_inventory' do
    stock = QBIntegration::Stock.new(@payload, @config)

    if stock.name.present? && stock.item
      inventory = stock.inventory
      inventory[:key] = @config[:flowlink_data_object_identifier] if @config[:flowlink_data_object_identifier]

      add_object :inventory, stock.inventory

      result 200
    elsif stock.items.present?
      stock.inventories.each do |item|
        item[:key] = @config[:flowlink_data_object_identifier] if @config[:flowlink_data_object_identifier]
        add_object :inventory, item
      end
      add_parameter 'quickbooks_poll_stock_timestamp', stock.last_modified_date

      result 200
    else
      result 200
    end
  end

  post '/get_customers' do
    qbo_customer = QBIntegration::Customer.new(@payload, @config)
    summary, page, since, code = qbo_customer.get()

    qbo_customer.customers.each do |customer|
      add_object :customer, qbo_customer.build_customer(customer)
    end

    add_parameter 'quickbooks_page_num', page
    add_parameter 'quickbooks_since', since
    result code, summary
  end

  post '/add_customer' do
    code, summary, customer = QBIntegration::Customer.new(@payload, @config).create

    add_object :customer, customer
    result code, summary
  end

  post '/update_customer' do
    code, summary, customer = QBIntegration::Customer.new(@payload, @config).update

    add_object :customer, customer
    result code, summary
  end

  post '/get_products' do
    qbo_item = QBIntegration::Item.new(@payload, @config)
    summary, page, since, code = qbo_item.get()

    qbo_item.items.each do |item|
      add_object :product, qbo_item.build_item(item)
    end

    add_parameter 'quickbooks_page_num', page
    add_parameter 'quickbooks_since', since

    result code, summary
  end

  post '/add_payment' do
    code, summary = QBIntegration::Payment.new(@payload, @config).create

    result code, summary
  end

  post '/get_payments' do
    qbo_payment = QBIntegration::Payment.new(@payload, @config)
    summary, page, since, code = qbo_payment.get()

    qbo_payment.new_or_updated_payments.each do |payment|
      add_object :payment, qbo_payment.build_payment(payment)
    end

    add_parameter 'quickbooks_page_num', page
    add_parameter 'quickbooks_since', since
    
    result code, summary
  end

  post '/add_bill_to_purchase_order' do
    code, summary, bill, po = QBIntegration::Bill.new(@payload, @config).create

    add_object :bill, bill
    add_object :purchase_order, po

    result code, summary
  end

  post '/add_credit_memo' do
    code, summary, memo = QBIntegration::CreditMemo.new(@payload, @config).create

    add_object :credit_memo, memo
    result code, summary
  end

  post '/update_credit_memo' do
    code, summary, memo = QBIntegration::CreditMemo.new(@payload, @config).update

    add_object :credit_memo, memo
    result code, summary
  end

  # ─── Error handler ──────────────────────────────────────────

  error do
    content_type :json if request.content_type&.include?('json')
    result 500, lookup_error_message
  end

  # ─── Helper methods ─────────────────────────────────────────

  private

  def parse_uploaded_file(tempfile, ext)
    require 'csv'
    case ext
    when '.csv'
      rows = CSV.read(tempfile.path, headers: true, liberal_parsing: true)
      data = rows.map { |r| r.to_h }
    when '.xlsx', '.xls'
      require 'roo'
      workbook = Roo::Spreadsheet.open(tempfile.path)
      sheet = workbook.sheet(0)
      headers = sheet.row(1).map(&:to_s)
      data = (2..sheet.last_row).map do |i|
        row = sheet.row(i)
        headers.zip(row).to_h
      end
    else
      raise "Unsupported format: #{ext}"
    end

    data.reject! { |r| r.values.all?(&:nil?) }
    columns = data.first&.keys || []

    {
      columns: columns,
      preview: data.first(10),
      totalRows: data.length,
      all_data: data
    }
  end

  def store_file_data(file_id, data)
    dir = File.join(File.dirname(__FILE__), 'tmp')
    FileUtils.mkdir_p(dir)
    File.write(File.join(dir, "#{file_id}.json"), JSON.dump(data))
  end

  def read_file_data(file_id)
    path = File.join(File.dirname(__FILE__), 'tmp', "#{file_id}.json")
    return nil unless File.exist?(path)
    JSON.parse(File.read(path), symbolize_names: true)
  end

  def delete_file_data(file_id)
    path = File.join(File.dirname(__FILE__), 'tmp', "#{file_id}.json")
    File.delete(path) if File.exist?(path)
  end

  def build_qbo_config(connection)
    {
      'quickbooks_access_token' => connection['access_token'],
      'quickbooks_access_secret' => connection['refresh_token'],
      'access_token' => connection['access_token'],
      'refresh_token' => connection['refresh_token'],
      'quickbooks_realm' => connection['realm_id'] || connection['company_id'],
      'realmId' => connection['realm_id'] || connection['company_id']
    }
  end

  def build_import_payload(type, row, mapping, defaults, date_format)
    val = ->(field) {
      col = mapping[field]
      col ? row[col.to_s]&.to_s&.strip : nil
    }

    case type
    when 'Customer'
      {
        'customer' => {
          'name' => val.call('name') || defaults['name'] || '',
          'email' => val.call('email') || '',
          'phone' => val.call('phone') || '',
          'billing_address' => {
            'address1' => val.call('address1') || '',
            'address2' => val.call('address2') || '',
            'city' => val.call('city') || '',
            'state' => val.call('state') || '',
            'country' => val.call('country') || '',
            'zipcode' => val.call('zipcode') || ''
          }
        },
        'parameters' => {}
      }
    when 'Vendor'
      {
        'vendor' => {
          'name' => val.call('name') || defaults['name'] || '',
          'email' => val.call('email') || '',
          'phone' => val.call('phone') || '',
          'street1' => val.call('street1') || '',
          'city' => val.call('city') || '',
          'state' => val.call('state') || '',
          'country' => val.call('country') || '',
          'zipcode' => val.call('zipcode') || ''
        },
        'parameters' => {}
      }
    when 'Bill'
      {
        'purchase_order' => {
          'id' => val.call('po_id') || '',
          'received_items' => [
            { 'sku' => val.call('sku') || '', 'quantity' => (val.call('quantity') || '0').to_f }
          ],
          'transaction_date' => val.call('transaction_date') || defaults['date'] || ''
        },
        'bill' => {},
        'parameters' => {}
      }
    when 'Expense'
      amount = (val.call('amount') || '0').gsub(/[^0-9.\-]/, '').to_f
      acct_name = val.call('account') || defaults['accountName'] || ''
      {
        'purchase' => {
          'account_ref' => { 'name' => acct_name },
          'line' => [{
            'amount' => amount.abs,
            'detail_type' => 'AccountBasedExpenseLineDetail',
            'account_based_expense_line_detail' => {
              'account_ref' => { 'name' => acct_name }
            }
          }],
          'entity_ref' => val.call('vendor') ? { 'name' => val.call('vendor'), 'type' => 'Vendor' } : nil,
          'payment_type' => defaults['paymentType'] || 'Check',
          'txn_date' => val.call('date') || defaults['date'] || ''
        }.compact,
        'parameters' => {}
      }
    else
      {}
    end
  end

  def call_qbo_endpoint(type, payload, config)
    result = nil

    case type
    when 'Customer'
      code, summary, obj = QBIntegration::Customer.new(payload, config).create
      qbo_id = obj.is_a?(Hash) ? (obj['qbo_id'] || obj[:qbo_id]) : nil
      result = { code: code, message: summary, qbo_id: qbo_id }
    when 'Vendor'
      code, summary, obj = QBIntegration::Vendor.new(payload, config).create
      qbo_id = obj.is_a?(Hash) ? (obj['qbo_id'] || obj[:qbo_id]) : nil
      result = { code: code, message: summary, qbo_id: qbo_id }
    when 'Bill'
      code, summary, bill, po = QBIntegration::Bill.new(payload, config).create
      qbo_id = bill.is_a?(Hash) ? (bill['id'] || bill[:id]) : nil
      result = { code: code, message: summary, qbo_id: qbo_id }
    when 'Expense'
      result = { code: 200, message: 'Expense import not directly supported via endpoint', qbo_id: nil }
    else
      raise "Unknown transaction type: #{type}"
    end

    raise result[:message] if result[:code] != 200
    result
  end

  def lookup_error_message
    case env['sinatra.error'].class.to_s
    when "Quickbooks::AuthorizationFailure"
      "Authorization failure. Please check your QuickBooks credentials"
    when "Quickbooks::ServiceUnavailable"
      "QuickBooks API appears to be inaccessible HTTP 503 returned."
    else
      env['sinatra.error'].message
    end
  end

  def notify_honeybadger(e)
    Honeybadger.notify(
      e,
      context: {
        payload: @payload,
        config: @config
      }
    )
  end
end
