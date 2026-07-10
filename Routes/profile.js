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
    if (!uid) throw badRequest('Unauthorized');

    const name = safeString(req.user?.name || null);
    const email = safeString(req.user?.email || null);
    // Firebase token decoded claims may not include photoURL; frontend already has it from client.
    const photo = safeString(req.body?.photo ?? null);

    // NOTE: We accept optional photo from body to align with current frontend dispatch.
    // Security: this is only cached; the source of truth for uid is token.

    try {
      const existing = await UserProfile.findOne({ firebaseUid: uid }).lean();

      if (existing) {
        // Do not overwrite existing fields aggressively.
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
          data: updated,
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

      return res.status(201).json({
        success: true,
        message: 'Profile created',
        data: created.toObject(),
      });
    } catch (err) {
      console.error('profile/bootstrap error:', err);
      const httpErr = internalServerError(err?.message || 'Internal Server Error');
      return res.status(httpErr.statusCode).json({
        success: false,
        message: httpErr.message,
        error: { message: httpErr.message },
      });
    }
  })
);

module.exports = router;

