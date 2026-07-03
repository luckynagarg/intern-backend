const mongoose = require("mongoose");

const Applicationipschema = new mongoose.Schema({
  company: String,
  category: String,
  coverLetter: String,
  user: Object, // legacy

  // Auth-enforced user reference
  userId: { type: String, index: true },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  status: {
    type: String,
    enum: ["accepted", "pending", "rejected"],
    default: "pending",
  },
  Application: Object,
});

Applicationipschema.index({ userId: 1, createdAt: 1 });

module.exports = mongoose.model("Application", Applicationipschema);

