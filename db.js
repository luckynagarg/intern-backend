const mongoose = require("mongoose");

module.exports.connect = async () => {
  const uri = process.env.DATABASE_URL;

  if (!uri) {
    console.warn("⚠️ DATABASE_URL is undefined. Mongo will be treated as unavailable.");
    return { mongoAvailable: false, reason: "missing DATABASE_URL" };
  }

  // Validate the connection string scheme up-front so the failure reason is
  // actionable instead of Mongoose's generic "Invalid scheme" message.
  if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
    const reason =
      'DATABASE_URL is not a valid MongoDB connection string. It must start with "mongodb://" or "mongodb+srv://". ' +
      "Check the DATABASE_URL value set in your environment (Render dashboard > Environment).";
    console.warn("⚠️ Database connection failed. Mongo will be treated as unavailable:", reason);
    return { mongoAvailable: false, reason };
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


