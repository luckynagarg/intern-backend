const express = require('express');
const router = express.Router();

const asyncHandler = require('../middleware/asyncHandler');
const { verifyFirebaseIdToken } = require('../middleware/authFirebase');

const { badRequest, forbidden, unauthorized, internalServerError, notFound } = require('../utils/httpErrors');

const FriendRequest = require('../Model/FriendRequest');
const Friendship = require('../Model/Friendship');
const UserProfile = require('../Model/UserProfile');
const Notification = require('../Model/Notification');

function toUserId(uid) {
  return typeof uid === 'string' ? uid : null;
}

async function ensureProfiles(uids) {
  const existing = await UserProfile.find({ firebaseUid: { $in: uids } }).lean();
  const existingSet = new Set(existing.map((x) => x.firebaseUid));
  const missing = uids.filter((id) => !existingSet.has(id));
  if (!missing.length) return;

  await UserProfile.insertMany(
    missing.map((firebaseUid) => ({
      firebaseUid,
      username: null,
      name: null,
      email: null,
      photo: null,
      headline: null,
      bio: null,
      location: null,
      skills: [],
      college: null,
      company: null,
      socialLinks: {},
      privacy: 'public',
      friends: [],
      friendCount: 0,
    }))
  );
}

async function areFriends(u1, u2) {
  const c = await Friendship.countDocuments({ userId: u1, friendId: u2, status: 'accepted' });
  return c > 0;
}

async function updateFriendshipUsersForAccepted(u1, u2) {
  const pairs = [
    { userId: u1, friendId: u2 },
    { userId: u2, friendId: u1 },
  ];

  await Promise.all(
    pairs.map(async ({ userId, friendId }) => {
      await Friendship.updateOne(
        { userId, friendId },
        { $set: { status: 'accepted' } },
        { upsert: true }
      );
    })
  );

  await Promise.all([
    UserProfile.updateOne({ firebaseUid: u1 }, { $addToSet: { friends: u2 } }),
    UserProfile.updateOne({ firebaseUid: u2 }, { $addToSet: { friends: u1 } }),
  ]);

  const [u1Count, u2Count] = await Promise.all([
    Friendship.countDocuments({ userId: u1, status: 'accepted' }),
    Friendship.countDocuments({ userId: u2, status: 'accepted' }),
  ]);

  await Promise.all([
    UserProfile.updateOne({ firebaseUid: u1 }, { $set: { friendCount: u1Count } }),
    UserProfile.updateOne({ firebaseUid: u2 }, { $set: { friendCount: u2Count } }),
  ]);
}

async function notify(userId, title, message, type = 'social') {
  await Notification.create({
    userId,
    title,
    message,
    type,
    read: false,
  });
}

// GET /api/friends/requests?userId=...
router.get(
  '/requests',
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const caller = toUserId(req.user?.uid);
    const userId = toUserId(req.query?.userId);

    if (!caller) throw unauthorized('Unauthorized');
    if (!userId) throw badRequest('userId is required');

    // Demo-friendly: allow mock users (e.g. u_0000) to read without a real
    // Firebase profile so the friends page doesn't 401-loop in dev.
    // Only real (non-mock) callers are restricted to viewing their own requests.
    const isMockUser = /^[a-z]+_\d+$/.test(userId) && !/^[A-Za-z0-9]{20,}$/.test(userId);
    if (caller !== userId && !isMockUser) {
      throw forbidden('You can only view your own requests.');
    }

    await ensureProfiles([userId]);

    const requests = await FriendRequest.find({
      $or: [
        { sender: userId },
        { receiver: userId },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    // Frontend expects senderId/receiverId/status and createdAtISO-ish.
    const normalized = requests.map((r) => ({
      _id: String(r._id),
      senderId: String(r.sender),
      receiverId: String(r.receiver),
      status: r.status,
      createdAtISO: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    }));

    return res.status(200).json({ data: normalized });
  })
);

// POST /api/friends/request
router.post(
  '/request',
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const sender = toUserId(req.user?.uid);
    const receiver = toUserId(req.body?.receiver);

    if (!sender) throw unauthorized('Unauthorized');
    if (!receiver) throw badRequest('receiver is required');
    if (sender === receiver) throw forbidden('Cannot send friend request to yourself.');

    await ensureProfiles([sender, receiver]);

    const existingReq = await FriendRequest.findOne({ sender, receiver, status: { $in: ['pending', 'accepted'] } });
    if (existingReq) throw forbidden('Friend request already sent.');

    if (await areFriends(sender, receiver)) {
      throw forbidden('You are already friends.');
    }

    const fr = await FriendRequest.create({ sender, receiver, status: 'pending' });

    const senderProfile = await UserProfile.findOne({ firebaseUid: sender }).lean();
    const senderName = senderProfile?.name || senderProfile?.username || 'Someone';

    await notify(
      receiver,
      `${senderName} sent you a friend request`,
      'You have a new friend request. Accept or reject it. ',
      'social'
    );

    return res.status(201).json({ success: true, data: fr });
  })
);

// POST /api/friends/accept
router.post(
  '/accept',
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const receiver = toUserId(req.user?.uid);
    const requestId = req.body?.requestId;
    const sender = toUserId(req.body?.sender);

    if (!receiver) throw unauthorized('Unauthorized');
    if (!requestId && !sender) throw badRequest('requestId or sender is required');

    await ensureProfiles([receiver, sender].filter(Boolean));

    const fr = requestId
      ? await FriendRequest.findOne({ _id: requestId, receiver })
      : await FriendRequest.findOne({ sender, receiver });

    if (!fr) throw notFound('Friend request not found');
    if (fr.status !== 'pending') throw forbidden('Friend request is not pending.');

    await updateFriendshipUsersForAccepted(fr.sender, receiver);

    fr.status = 'accepted';
    await fr.save();

    const senderProfile = await UserProfile.findOne({ firebaseUid: fr.sender }).lean();
    const receiverName = (await UserProfile.findOne({ firebaseUid: receiver }).lean())?.name || 'Your friend';
    const senderName = senderProfile?.name || senderProfile?.username || 'Someone';

    await notify(
      fr.sender,
      `${receiverName} accepted your friend request`,
      'Your friend request was accepted. You can now message each other.',
      'social'
    );

    return res.status(200).json({ success: true });
  })
);

// POST /api/friends/reject
router.post(
  '/reject',
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const receiver = toUserId(req.user?.uid);
    const requestId = req.body?.requestId;
    const sender = toUserId(req.body?.sender);

    if (!receiver) throw unauthorized('Unauthorized');
    if (!requestId && !sender) throw badRequest('requestId or sender is required');

    const fr = requestId
      ? await FriendRequest.findOne({ _id: requestId, receiver })
      : await FriendRequest.findOne({ sender, receiver });

    if (!fr) throw badRequest('Friend request not found');
    if (fr.status !== 'pending') throw forbidden('Friend request is not pending.');

    fr.status = 'rejected';
    await fr.save();

    const senderProfile = await UserProfile.findOne({ firebaseUid: fr.sender }).lean();
    const receiverProfile = await UserProfile.findOne({ firebaseUid: receiver }).lean();

    const senderName = senderProfile?.name || senderProfile?.username || 'Your friend';
    const receiverName = receiverProfile?.name || receiverProfile?.username || 'Someone';

    await notify(
      fr.sender,
      `${receiverName} rejected your friend request`,
      'Your friend request was rejected.',
      'social'
    );

    return res.status(200).json({ success: true });
  })
);

// GET /api/friends/search?q=...
router.get(
  "/search",
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const caller = toUserId(req.user?.uid);
    const qRaw = req.query?.q;

    if (!caller) throw unauthorized("Unauthorized");

    const q = String(qRaw || "").trim();
    if (!q) {
      return res.status(200).json({ data: [] });
    }

    // Only search within authenticated user's accepted friends
    const friendIds = await Friendship.find({ userId: caller, status: "accepted" })
      .select({ friendId: 1, _id: 0 })
      .lean();

    const ids = friendIds.map((x) => x.friendId).filter(Boolean);
    if (!ids.length) return res.status(200).json({ data: [] });

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "i");

    // Search across friend profile fields and friendship nickname
    const friends = await Friendship.aggregate([
      { $match: { userId: caller, status: "accepted", friendId: { $in: ids } } },
      {
        $lookup: {
          from: "userprofiles",
          localField: "friendId",
          foreignField: "firebaseUid",
          as: "profile",
        },
      },
      // Ensure we only return matches where the friend profile exists.
      { $match: { "profile.firebaseUid": { $exists: true, $ne: null } } },
      { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $or: [
            { "profile.name": { $regex: re } },
            { "profile.username": { $regex: re } },
            { nickname: { $regex: re } },
            { "profile.email": { $regex: re } },
          ],
        },
      },
      { $limit: 20 },
      {
        $project: {
          _id: 1,
          name: "$profile.name",
          username: "$profile.username",
          nickname: "$nickname",
          photo: "$profile.photo",
          headline: "$profile.headline",
          isFriend: { $literal: true },
        },
      },
    ]);

    // Ensure required fields exist with safe defaults
    const normalized = (friends || []).map((f) => ({
      _id: String(f._id),
      name: f.name || null,
      username: f.username || null,
      nickname: f.nickname || null,
      photo: f.photo || null,
      headline: f.headline || null,
      isFriend: !!f.isFriend,
    }));

    return res.status(200).json({ data: normalized });
  })
);

// PATCH /api/friends/:friendId/nickname
router.patch(
  "/:friendId/nickname",
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const caller = toUserId(req.user?.uid);
    const friendId = toUserId(req.params?.friendId);
    let nickname = req.body?.nickname;

    if (!caller) throw unauthorized("Unauthorized");
    if (!friendId) throw badRequest("friendId is required");
    if (caller === friendId) throw forbidden("Cannot set nickname for yourself.");

    // validate friendship ownership & accepted status
    const friendship = await Friendship.findOne({
      userId: caller,
      friendId,
      status: "accepted",
    });

    if (!friendship) throw forbidden("You are not friends.");

    nickname = nickname === undefined ? null : String(nickname);
    nickname = nickname.trim();

    if (!nickname) nickname = null;

    if (nickname && nickname.length > 50) {
      throw badRequest("Nickname must be 50 characters or less.");
    }

    friendship.nickname = nickname;
    await friendship.save();

    // Return updated friendship doc with shape expected by frontend
    return res.status(200).json({ success: true, data: friendship });
  })
);

// DELETE /api/friends/remove
router.delete(
  '/remove',
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const userId = toUserId(req.user?.uid);
    const friendId = toUserId(req.body?.friendId);

    if (!userId) throw unauthorized('Unauthorized');
    if (!friendId) throw badRequest('friendId is required');
    if (userId === friendId) throw forbidden('Cannot remove yourself.');

    const isFriend = await areFriends(userId, friendId);
    if (!isFriend) throw forbidden('You are not friends.');

    await Promise.all([
      Friendship.deleteMany({ userId, friendId, status: 'accepted' }),
      Friendship.deleteMany({ userId: friendId, friendId: userId, status: 'accepted' }),
    ]);

    await Promise.all([
      UserProfile.updateOne({ firebaseUid: userId }, { $pull: { friends: friendId } }),
      UserProfile.updateOne({ firebaseUid: friendId }, { $pull: { friends: userId } }),
    ]);

    const [uCount, fCount] = await Promise.all([
      Friendship.countDocuments({ userId, status: 'accepted' }),
      Friendship.countDocuments({ userId: friendId, status: 'accepted' }),
    ]);

    await Promise.all([
      UserProfile.updateOne({ firebaseUid: userId }, { $set: { friendCount: uCount } }),
      UserProfile.updateOne({ firebaseUid: friendId }, { $set: { friendCount: fCount } }),
    ]);

    return res.status(200).json({ success: true });
  })
);

module.exports = router;


