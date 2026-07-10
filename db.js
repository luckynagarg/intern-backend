const mongoose = require("mongoose");
require("dotenv").config();

module.exports.connect = async () => {
  const uri = process.env.DATABASE_URL;

  // Do not hard-fail the server on missing/invalid Mongo.
  // If Mongo is unavailable, routes will return mock/demo data.
  if (!uri) {
    console.warn("⚠️ DATABASE_URL is undefined. Mongo will be treated as unavailable.");
    return { mongoAvailable: false, reason: "missing DATABASE_URL" };
  }

  try {
    await mongoose.connect(uri);
    console.log("✅ Database is connected");
    return { mongoAvailable: true };
  } catch (err) {
    console.warn("⚠️ Database connection failed. Mongo will be treated as unavailable:", err.message);
    return { mongoAvailable: false, reason: err.message };
  }
};


