const mongoose = require("mongoose");

module.exports.connect = async () => {
  const uri = process.env.DATABASE_URL;

  if (!uri) {
    console.warn("⚠️ DATABASE_URL is undefined. Mongo will be treated as unavailable.");
    return { mongoAvailable: false, reason: "missing DATABASE_URL" };
  }

  try {
    // Fail fast when the cluster is unreachable instead of buffering queries for 10s.
    // With bufferCommands:false, any query issued before the connection is ready will
    // immediately throw a MongooseError rather than silently buffering and timing out.
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      bufferCommands: false,
    });
    console.log("✅ Database is connected");
    console.log(`✅ Connected to MongoDB: ${mongoose.connection.host}/${mongoose.connection.name}`);
    return { mongoAvailable: true };
  } catch (err) {
    console.warn("⚠️ Database connection failed. Mongo will be treated as unavailable:", err.message);
    return { mongoAvailable: false, reason: err.message };
  }
};


