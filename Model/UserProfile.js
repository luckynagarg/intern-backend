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
    },

username: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },

    // Public nickname (@username style). Unique, validated 4-20 chars.
    nickname: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      trim: true,
    },
    // Lowercased copy of nickname for case-insensitive unique + search.
    lowercaseNickname: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },
    // Timestamp of last nickname change (for release-on-change logic).
    nicknameUpdatedAt: { type: Date, default: null },

    name: { type: String, default: null, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    photo: { type: String, default: null },
    profilePhoto: { type: String, default: null },
    coverPhoto: { type: String, default: null },

    headline: { type: String, default: null },
    bio: { type: String, default: null },

    // Verified badge flag for users (admin-verified accounts).
    verified: { type: Boolean, default: false },

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

// Once-per-day password reset restriction for Firebase Auth password updates.
    // Backward compatible: existing users will have `null/undefined`.
    lastPasswordResetAt: { type: Date, default: null },

    // Languages the user has verified via OTP (e.g. switching to French).
    // This is a server-side record so the frontend cannot bypass verification
    // by simply setting a localStorage flag. Backward compatible.
    verifiedLanguages: {
      type: [String],
      default: [],
      index: true,
    },
  },
  {
    // We manage updatedAt manually to keep schema consistent with existing style.
    timestamps: false,
  }
);

// firebaseUid and username declare `unique: true` in the field definition,
// which already creates the unique indexes. Declaring schema.index() here as
// well caused duplicate-index warnings from Mongoose, so they were removed.

UserProfileSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('UserProfile', UserProfileSchema);

