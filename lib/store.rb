require 'json'
require 'fileutils'

module QBIntegration
  class Store
    DATA_DIR = File.expand_path('../../data', __dir__)
    FILE_PATH = File.join(DATA_DIR, 'store.json')

    def self.init
      FileUtils.mkdir_p(DATA_DIR) unless Dir.exist?(DATA_DIR)
      unless File.exist?(FILE_PATH)
        File.write(FILE_PATH, JSON.pretty_generate({
          qbo_connections: [],
          imports: [],
          import_logs: [],
          _ids: { qbo_connections: 1, imports: 1, import_logs: 1 }
        }))
      end
    end

    def self.data
      init unless File.exist?(FILE_PATH)
      JSON.parse(File.read(FILE_PATH))
    end

    def self.save(d)
      File.write(FILE_PATH, JSON.pretty_generate(d))
    end

    def self.all(table, where = {})
      data[table].select { |r| matches?(r, where) }
    end

    def self.get(table, where)
      data[table].find { |r| matches?(r, where) }
    end

    def self.insert(table, fields)
      d = data
      id = d['_ids'][table]
      d['_ids'][table] = id + 1
      record = fields.merge('id' => id, 'created_at' => Time.now.utc.iso8601)
      d[table].push(record)
      save(d)
      record
    end

    def self.update(table, where, fields)
      d = data
      count = 0
      d[table] = d[table].map do |r|
        if matches?(r, where)
          count += 1
          r.merge(fields)
        else
          r
        end
      end
      save(d) if count > 0
      count
    end

    def self.delete(table, where)
      d = data
      before = d[table].length
      d[table] = d[table].reject { |r| matches?(r, where) }
      changes = before - d[table].length
      save(d) if changes > 0
      changes
    end

    def self.matches?(record, where)
      where.all? { |k, v| record[k.to_s] == v }
    end
  end
end
