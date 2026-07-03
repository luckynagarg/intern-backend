const mongoose = require("mongoose");
require("dotenv").config();

module.exports.connect = async () => {
  const uri = process.env.DATABASE_URL;

  if (!uri) {
    console.error("❌ DATABASE_URL is undefined.");
    console.error("Expected env var: process.env.DATABASE_URL");
    console.error("Fix: create backend/.env with DATABASE_URL=<your_mongo_uri>");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log("✅ Database is connected");
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1);
  }
};

