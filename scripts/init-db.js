const database = require("../database");

async function main() {
  const shouldSeed = process.argv.includes("--seed");
  await database.initializeSchema();
  if (shouldSeed) {
    await database.seedSampleData();
  }
  const status = await database.ping();
  console.log(`Database ready: ${status.database_name}`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => database.close());
