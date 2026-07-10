const express = require('express');
const router = express.Router();

const asyncHandler = require('../middleware/asyncHandler');
const { verifyFirebaseIdToken } = require('../middleware/authFirebase');

const { badRequest, internalServerError } = require('../utils/httpErrors');

const UserProfile = require('../Model/UserProfile');

function safeString(x) {
  return typeof x === 'string' ? x : null;
}

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


