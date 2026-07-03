const mongoose = require("mongoose");

const PublicPostSchema = new mongoose.Schema({
  author: {
    userId: { type: String, required: true, index: true },
    name: { type: String },
    photo: { type: String },
  },
  caption: { type: String, default: "" },
  media: {
    mediaType: { type: String, enum: ["image", "video"], required: true },
    url: { type: String, required: true },
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("PublicPost", PublicPostSchema);

