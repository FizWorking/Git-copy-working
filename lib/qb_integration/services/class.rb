module QBIntegration
  module Service
    class Class < Base
      attr_reader :config

      def initialize(config)
        super("Class", config)

        @config = config
        @model_name = "Class"
      end

      def find_class(value)
        find_by_id(value) || find_by_name(value)
      end

      def find_by_name(name)
        util = Quickbooks::Util::QueryBuilder.new
        clause = util.clause("Name", "=", name)

        query = "SELECT * FROM Class WHERE #{clause}"
        quickbooks.query(query).entries.first
      end

      def find_by_id(id)
        util = Quickbooks::Util::QueryBuilder.new
        clause = util.clause("id", "=", id)

        query = "SELECT * FROM Class WHERE #{clause}"
        quickbooks.query(query).entries.first
      end
    end
  end
end
