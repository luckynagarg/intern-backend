const express = require('express');
const router = express.Router();

const asyncHandler = require('../middleware/asyncHandler');
const { verifyFirebaseIdToken } = require('../middleware/authFirebase');

const { badRequest, internalServerError } = require('../utils/httpErrors');

const UserProfile = require('../Model/UserProfile');

function safeString(x) {
  return typeof x === 'string' ? x : null;
}

const NICKNAME_REGEX = /^[A-Za-z0-9_]{4,20}$/;

function normalizeNickname(n) {
  return typeof n === 'string' ? n.trim().replace(/^@+/, '') : '';
}

// PATCH /api/profile/nickname
// Change the user's unique nickname. Old nickname becomes available again.
router.patch(
  '/nickname',
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ success: false, message: 'Unauthorized', error: { message: 'Unauthorized' } });

    const raw = normalizeNickname(req.body?.nickname);
    if (!raw) {
      return res.status(400).json({ success: false, message: 'nickname is required', error: { message: 'nickname is required' } });
    }
    if (!NICKNAME_REGEX.test(raw)) {
      return res.status(400).json({
        success: false,
        message: 'Nickname must be 4-20 characters and contain only letters, numbers, and underscores.',
        error: { message: 'Nickname must be 4-20 characters and contain only letters, numbers, and underscores.' },
      });
    }

    const lowercase = raw.toLowerCase();

    // Ensure uniqueness (case-insensitive), excluding self.
    const taken = await UserProfile.findOne({
      lowercaseNickname: lowercase,
      firebaseUid: { $ne: uid },
    }).select('_id').lean();

    if (taken) {
      return res.status(409).json({ success: false, message: 'Nickname is already taken.', error: { message: 'Nickname is already taken.' } });
    }

    // Update profile: set new nickname + lowercase, update timestamp.
    // The old nickname is simply overwritten, thereby freeing it (it is not
    // referenced elsewhere in the app, so no foreign-key cleanup required).
    const updated = await UserProfile.findOneAndUpdate(
      { firebaseUid: uid },
      {
        $set: {
          nickname: raw,
          lowercaseNickname: lowercase,
          nicknameUpdatedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { new: true }
    )
      .select('firebaseUid name username nickname bio photo profilePhoto headline jobs')
      .lean();

    if (!updated) {
      return res.status(500).json({ success: false, message: 'Profile not found. Please bootstrap your profile first.', error: { message: 'Profile not found' } });
    }

    return res.status(200).json({
      success: true,
      message: 'Nickname updated.',
      data: {
        _id: updated.firebaseUid,
        nickname: updated.nickname,
        username: updated.username,
        name: updated.name,
        photo: updated.photo,
      },
    });
  })
);

// POST /api/profile/bootstrap
// Lazy-creates a UserProfile document for the authenticated Firebase user.
// Backward compatible: does not affect any existing routes.
router.post(
  '/bootstrap',
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const uid = req.user?.uid;
    const reqUrl = req.originalUrl;

    const logBase = () => ({
      url: reqUrl,
      userId: uid || null,
    });

    try {
      if (!uid) {
        // Auth middleware should normally guarantee uid.
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
          error: { message: 'Unauthorized' },
          ...logBase(),
        });
      }

      const name = safeString(req.user?.name ?? null);
      const email = safeString(req.user?.email ?? null);
      const photo = safeString(req.body?.photo ?? null);

      const existing = await UserProfile.findOne({ firebaseUid: uid }).lean();

      if (existing) {
        const patch = {};
        if (name && !existing.name) patch.name = name;
        if (email && !existing.email) patch.email = email;
        if (photo && !existing.photo) patch.photo = photo;

        if (Object.keys(patch).length) {
          await UserProfile.updateOne(
            { firebaseUid: uid },
            { $set: { ...patch, updatedAt: new Date() } }
          );
        }

        const updated = await UserProfile.findOne({ firebaseUid: uid }).lean();
        return res.status(200).json({
          success: true,
          message: 'Profile ready',
          data: updated || existing,
          ...logBase(),
        });
      }

      const created = await UserProfile.create({
        firebaseUid: uid,
        name: name || null,
        email: email || null,
        photo: photo || null,
        username: null,
        headline: null,
        bio: null,
        location: null,
        skills: [],
        college: null,
        company: null,
        socialLinks: {},
        privacy: 'public',
      });

      return res.status(200).json({
        success: true,
        message: 'Profile created',
        data: created?.toObject?.() ?? created,
        ...logBase(),
      });
    } catch (err) {
      // Never throw uncaught exceptions from this endpoint.
      const message = err?.message ? String(err.message) : 'Internal Server Error';
      console.error('profile/bootstrap error:', {
        message,
        stack: err?.stack,
        ...logBase(),
      });

      return res.status(500).json({
        success: false,
        message: 'Internal Server Error',
        error: { message },
        ...logBase(),
      });
    }
  })
);

module.exports = router;


