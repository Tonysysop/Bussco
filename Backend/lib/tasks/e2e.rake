namespace :e2e do
  desc "Empty the browser-check database and its uploaded files and mails (RAILS_ENV=e2e, bussco_e2e only)"
  task reset: :environment do
    database = ActiveRecord::Base.connection.current_database
    unless Rails.env.e2e? && database == "bussco_e2e"
      abort "e2e:reset refused: it only empties bussco_e2e under RAILS_ENV=e2e (got #{Rails.env}, #{database})."
    end

    ActiveRecord::Tasks::DatabaseTasks.truncate_all # keeps the schema
    FileUtils.rm_rf([ Rails.root.join("tmp/storage-e2e"), Rails.root.join("tmp/mails-e2e") ])
    puts "Emptied #{database}, tmp/storage-e2e and tmp/mails-e2e."
  end
end
