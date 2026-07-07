const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: {
    type: String,
    enum: [
      'application',
      'internship',
      'announcement',
      'profile',
      'social',
      'admin',
    ],
    required: true,
  },
  read: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now },
});

// De-dupe helper: for seeded notifications, prevent same title+message duplicates per user.
NotificationSchema.index({ userId: 1, title: 1, message: 1 }, { unique: false });

module.exports = mongoose.model('Notification', NotificationSchema);

