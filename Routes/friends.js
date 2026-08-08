const express = require('express');
const router = express.Router();

const asyncHandler = require('../middleware/asyncHandler');
const { verifyFirebaseIdToken } = require('../middleware/authFirebase');

const { badRequest, forbidden, unauthorized, internalServerError, notFound } = require('../utils/httpErrors');

const FriendRequest = require('../Model/FriendRequest');
const Friendship = require('../Model/Friendship');
const UserProfile = require('../Model/UserProfile');
const Notification = require('../Model/Notification');
const { createNotification } = require('../services/notificationService');

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

// Helper to build a normalized friend profile object from a UserProfile doc and relationship.
function toFriendProfile(profile, relationship) {
  return {
    _id: profile.firebaseUid,
    uid: profile.firebaseUid,
    name: profile.name || null,
    username: profile.username || null,
    nickname: profile.nickname || null,
    photo: profile.photo || profile.profilePhoto || null,
    headline: profile.headline || null,
    bio: profile.bio || null,
    location: profile.location || null,
    friendCount: profile.friendCount || 0,
    relationship: relationship || 'none',
  };
}

// GET /api/friends/list — accepted friends of the caller, with mutual counts.
router.get(
  '/list',
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const caller = toUserId(req.user?.uid);
    if (!caller) throw unauthorized('Unauthorized');

    const friendships = await Friendship.find({ userId: caller, status: 'accepted' }).lean();
    const friendIds = friendships.map((f) => f.friendId).filter(Boolean);

    if (!friendIds.length) {
      return res.status(200).json({ success: true, data: [], pagination: { total: 0, page: 1, pageSize: friendIds.length } });
    }

    const profiles = await UserProfile.find({ firebaseUid: { $in: friendIds } }).lean();
    const profileMap = new Map(profiles.map((p) => [p.firebaseUid, p]));

    const data = friendIds
      .map((friendId) => profileMap.get(friendId))
      .filter(Boolean)
      .map((p) => toFriendProfile(p, 'friends'));

    return res.status(200).json({ success: true, data, pagination: { total: data.length, page: 1, pageSize: data.length } });
  })
);

// GET /api/friends/pending — incoming pending requests with sender profile.
router.get(
  '/pending',
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const caller = toUserId(req.user?.uid);
    if (!caller) throw unauthorized('Unauthorized');

    const requests = await FriendRequest.find({ receiver: caller, status: 'pending' })
      .sort({ createdAt: -1 })
      .lean();

    const senderIds = [...new Set(requests.map((r) => r.sender).filter(Boolean))];
    const profiles = senderIds.length
      ? await UserProfile.find({ firebaseUid: { $in: senderIds } }).lean()
      : [];
    const profileMap = new Map(profiles.map((p) => [p.firebaseUid, p]));

    const data = requests.map((r) => ({
      _id: String(r._id),
      requestId: String(r._id),
      senderId: String(r.sender),
      receiverId: String(r.receiver),
      status: r.status,
      createdAtISO: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
      sender: profileMap.get(r.sender)
        ? toFriendProfile(profileMap.get(r.sender), 'request_received')
        : null,
    })).sort((a, b) => new Date(b.createdAtISO) - new Date(a.createdAtISO));

    return res.status(200).json({ success: true, data });
  })
);

// GET /api/friends/sent — outgoing pending/cancellable requests with receiver profile.
router.get(
  '/sent',
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const caller = toUserId(req.user?.uid);
    if (!caller) throw unauthorized('Unauthorized');

    const requests = await FriendRequest.find({ sender: caller, status: 'pending' })
      .sort({ createdAt: -1 })
      .lean();

    const receiverIds = [...new Set(requests.map((r) => r.receiver).filter(Boolean))];
    const profiles = receiverIds.length
      ? await UserProfile.find({ firebaseUid: { $in: receiverIds } }).lean()
      : [];
    const profileMap = new Map(profiles.map((p) => [p.firebaseUid, p]));

    const data = requests.map((r) => ({
      _id: String(r._id),
      requestId: String(r._id),
      senderId: String(r.sender),
      receiverId: String(r.receiver),
      status: r.status,
      createdAtISO: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
      receiver: profileMap.get(r.receiver)
        ? toFriendProfile(profileMap.get(r.receiver), 'request_sent')
        : null,
    })).sort((a, b) => new Date(b.createdAtISO) - new Date(a.createdAtISO));

    return res.status(200).json({ success: true, data });
  })
);

// GET /api/friends/requests?userId=... (legacy combined view)
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

    await createNotification({
      userId: receiver,
      title: `${senderName} sent you a friend request`,
      message: 'You have a new friend request. Accept or reject it.',
      type: 'social',
      fromUser: sender,
      link: '/friends',
      action: 'View',
      entityType: 'friend_request',
      entityId: String(fr._id),
    });

    return res.status(201).json({ success: true, data: fr });
  })
);

// POST /api/friends/cancel — cancel an outgoing pending request.
router.post(
  '/cancel',
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const sender = toUserId(req.user?.uid);
    const receiver = toUserId(req.body?.receiver);

    if (!sender) throw unauthorized('Unauthorized');
    if (!receiver) throw badRequest('receiver is required');
    if (sender === receiver) throw forbidden('Cannot cancel request to yourself.');

    const fr = await FriendRequest.findOneAndDelete({ sender, receiver, status: 'pending' });
    if (!fr) throw notFound('Pending friend request not found.');

    return res.status(200).json({ success: true });
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

    await createNotification({
      userId: fr.sender,
      title: `${receiverName} accepted your friend request`,
      message: 'Your friend request was accepted. You can now message each other.',
      type: 'social',
      fromUser: receiver,
      link: '/friends',
      action: 'View',
      entityType: 'friendship',
      entityId: String(receiver),
    });

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

    await createNotification({
      userId: fr.sender,
      title: `${receiverName} rejected your friend request`,
      message: 'Your friend request was rejected.',
      type: 'social',
      fromUser: receiver,
      link: '/friends',
      action: 'View',
      entityType: 'friend_request',
      entityId: String(receiver),
    });

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
