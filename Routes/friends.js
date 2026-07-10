const express = require('express');
const router = express.Router();

const asyncHandler = require('../middleware/asyncHandler');
const { verifyFirebaseIdToken } = require('../middleware/authFirebase');

const { badRequest, forbidden, unauthorized, internalServerError } = require('../utils/httpErrors');

const FriendRequest = require('../Model/FriendRequest');
const Friendship = require('../Model/Friendship');
const UserProfile = require('../Model/UserProfile');
const Notification = require('../Model/Notification');

function toUserId(uid) {
  return typeof uid === 'string' ? uid : null;
}

async function ensureProfiles(uids) {
  // Backward compatibility: some older users may not have a profile doc.
  // Create lazy skeleton docs so friend/search/chat can work.
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

function makeFriendStatusPair(a, b) {
  // Normalize friend friendship storage: we treat friendship as bidirectional by storing two docs.
  return [
    { userId: a, friendId: b },
    { userId: b, friendId: a },
  ];
}

async function areFriends(u1, u2) {
  const c = await Friendship.countDocuments({ userId: u1, friendId: u2, status: 'accepted' });
  return c > 0;
}

async function getMutualFriendCount(a, b) {
  // Mutual count based on accepted friendships.
  // For performance we only pull friendId arrays for the smaller side.
  const [aFriends, bFriends] = await Promise.all([
    Friendship.find({ userId: a, status: 'accepted' }).select('friendId').lean(),
    Friendship.find({ userId: b, status: 'accepted' }).select('friendId').lean(),
  ]);

  const aSet = new Set(aFriends.map((x) => x.friendId));
  let mutual = 0;
  for (const x of bFriends) {
    if (aSet.has(x.friendId)) mutual += 1;
  }
  return mutual;
}

async function updateFriendshipUsersForAccepted(u1, u2) {
  // Store in Friendship (compat) + update UserProfile friends list/count.
  // Ensure both directions exist.
  const pairs = makeFriendStatusPair(u1, u2);

  // Upsert without throwing on duplicates.
  await Promise.all(
    pairs.map(async ({ userId, friendId }) => {
      await Friendship.updateOne(
        { userId, friendId },
        { $set: { status: 'accepted' } },
        { upsert: true }
      );
    })
  );

  // Update UserProfile arrays & counts.
  // We use $addToSet + $inc where possible. For counts consistency, we compute instead.
  await Promise.all([
    UserProfile.updateOne({ firebaseUid: u1 }, { $addToSet: { friends: u2 } }),
    UserProfile.updateOne({ firebaseUid: u2 }, { $addToSet: { friends: u1 } }),
  ]);

  // Recompute friendCount from friendships for correctness.
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

    // Cannot send duplicate requests.
    const existingReq = await FriendRequest.findOne({ sender, receiver, status: { $in: ['pending', 'accepted'] } });
    if (existingReq) throw forbidden('Friend request already sent.');

    // Cannot send request if already friends.
    if (await areFriends(sender, receiver)) {
      throw forbidden('You are already friends.');
    }

    // Create pending request.
    const fr = await FriendRequest.create({ sender, receiver, status: 'pending' });

    // Notification: request received.
    // Need sender display name.
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
    const sender = toUserId(req.body?.sender); // allow alternate flow

    if (!receiver) throw unauthorized('Unauthorized');
    if (!requestId && !sender) throw badRequest('requestId or sender is required');

    await ensureProfiles([receiver, sender].filter(Boolean));

    const fr = requestId
      ? await FriendRequest.findOne({ _id: requestId, receiver })
      : await FriendRequest.findOne({ sender, receiver });

    if (!fr) throw notFound('Friend request not found');
    if (fr.status !== 'pending') throw forbidden('Friend request is not pending.');

    // Update friendship
    await updateFriendshipUsersForAccepted(fr.sender, receiver);

    // Update request status
    fr.status = 'accepted';
    await fr.save();

    // Notification: accepted.
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

    // Only allow remove if they are friends.
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

