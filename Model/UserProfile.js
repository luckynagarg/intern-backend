const mongoose = require('mongoose');

// Application-specific profile data linked to Firebase Auth.
// IMPORTANT: This does NOT replace Firebase Auth. It extends it.
// All security derives from Firebase ID tokens in controllers/routes.

const UserProfileSchema = new mongoose.Schema(
  {
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    username: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    name: { type: String, default: null, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    photo: { type: String, default: null },

    headline: { type: String, default: null },
    bio: { type: String, default: null },

    location: { type: String, default: null },
    skills: { type: [String], default: [] },

    college: { type: String, default: null },
    company: { type: String, default: null },

    socialLinks: {
      // Flexible structure for future extensibility
      type: Object,
      default: {},
    },

    privacy: {
      type: String,
      enum: ['public', 'friends', 'private'],
      default: 'public',
      index: true,
    },

    // Social graph fields (backward-compatible; existing docs will have defaults)
    friends: {
      type: [String],
      default: [],
      index: true,
    },
    friendCount: {
      type: Number,
      default: 0,
      index: true,
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    // We manage updatedAt manually to keep schema consistent with existing style.
    timestamps: false,
  }
);

UserProfileSchema.index({ firebaseUid: 1 }, { unique: true });
UserProfileSchema.index({ username: 1 }, { unique: true, sparse: true });

UserProfileSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('UserProfile', UserProfileSchema);

