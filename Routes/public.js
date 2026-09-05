const express = require("express");
const router = express.Router();

const PublicPost = require("../Model/PublicPost");
const PostComment = require("../Model/PostComment");
const PostLike = require("../Model/PostLike");
const Friendship = require("../Model/Friendship");
const DailyPostLimit = require("../Model/DailyPostLimit");

const { verifyFirebaseIdToken } = require("../middleware/authFirebase");
const { badRequest } = require("../utils/httpErrors");
const { createNotification } = require("../services/notificationService");

function getTodayYMD() {
  // Use IST consistently for daily posting limits so they roll over at
  // midnight IST regardless of the server's timezone.
  const timeZone = process.env.PAYMENT_TIMEZONE || 'Asia/Kolkata';
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function computeAllowedPerDay(friendsCount) {
  if (!friendsCount || friendsCount <= 0) return 0;
  if (friendsCount === 1) return 1;
  if (friendsCount === 2) return 2;
  // Business rule: 10+ friends => unlimited posting.
  if (friendsCount >= 10) return Number.POSITIVE_INFINITY;
  // 3..9
  return friendsCount;
}

// Auth-protected: create a post. Identity is derived from the verified
// Firebase token (req.user.uid), never from the request body.
router.post("/posts", verifyFirebaseIdToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { name, photo, caption, mediaUrl, mediaType } = req.body;

    // Media is optional — text-only posts are allowed. When media IS provided,
    // validate the media type and require a real http(s) URL so the feed can't
    // be abused as a free-form script/URL sink.
    const hasMedia = !!mediaUrl && !!mediaType;
    if (hasMedia) {
      const ALLOWED_MEDIA_TYPES = ["image", "video"];
      if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
        return res.status(400).json({ error: "mediaType must be image or video." });
      }
      if (typeof mediaUrl !== "string" || !/^https?:\/\/[^\s]+$/i.test(mediaUrl)) {
        return res.status(400).json({ error: "mediaUrl must be a valid http(s) URL." });
      }
    }
    if (caption && typeof caption === "string" && caption.length > 5000) {
      return res.status(400).json({ error: "caption is too long." });
    }

    const friendsCount = await Friendship.countDocuments({
      userId,
      status: "accepted",
    });

    const allowedPerDay = computeAllowedPerDay(friendsCount);

    if (allowedPerDay !== Number.POSITIVE_INFINITY) {
      const today = getTodayYMD();

      // Atomically increment only if count < allowedPerDay
      const updated = await DailyPostLimit.findOneAndUpdate(
        { userId, date: today, count: { $lt: allowedPerDay } },
        { $inc: { count: 1 } },
        { new: true }
      );

      if (!updated) {
        if (allowedPerDay <= 0) {
          return res.status(403).json({ error: "You need at least 1 friend to post." });
        }

        const existing = await DailyPostLimit.findOne({ userId, date: today });
        if (existing && existing.count >= allowedPerDay) {
          return res.status(403).json({ error: "Daily posting limit reached." });
        }

        // create new day doc with count=1
        await DailyPostLimit.create({ userId, date: today, count: 1 });
      }
    }

    // media is an array of { mediaType, url }. Only include media
    // when both fields are present; otherwise store an empty array
    // (text-only posts are allowed).
    const media = hasMedia
      ? [{ mediaType, url: mediaUrl }]
      : [];

    const post = await PublicPost.create({
      author: { userId, name: name || "", photo: photo || "" },
      caption: caption || "",
      media,
    });

    return res.status(201).json(post);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// Public (unauthenticated) feed browsing.
router.get("/posts", async (req, res) => {
  try {

    const limit = Math.min(parseInt(req.query.limit || "20", 10), 50);
    const cursor = req.query.cursor;

    const query = {};
    if (cursor) {
      query.createdAt = { $lt: new Date(cursor) };
    }

    const posts = await PublicPost.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const postIds = posts.map((p) => p._id.toString());

    let likesMap = {};
    let commentsMap = {};

    if (postIds.length) {
      const [likesAgg, commentsAgg] = await Promise.all([
        PostLike.aggregate([
          { $match: { postId: { $in: postIds } } },
          { $group: { _id: "$postId", count: { $sum: 1 } } },
        ]),
        PostComment.aggregate([
          { $match: { postId: { $in: postIds } } },
          { $group: { _id: "$postId", count: { $sum: 1 } } },
        ]),
      ]);

      likesMap = Object.fromEntries(likesAgg.map((x) => [x._id, x.count]));
      commentsMap = Object.fromEntries(commentsAgg.map((x) => [x._id, x.count]));
    }

    // Normalize media to a stable shape for the frontend.
    // Schema stores `media` as an array; the public page reads `media.mediaType`
    // and `media.url` directly, so flatten to the first media item (or null).
    const normalizeMedia = (media) => {
      if (!media) return null;
      if (Array.isArray(media)) return media[0] || null;
      return media;
    };

    res.json({
      posts: posts.map((p) => ({
        ...p,
        media: normalizeMedia(p.media),
        likesCount: likesMap[p._id.toString()] || 0,
        commentsCount: commentsMap[p._id.toString()] || 0,
      })),
      nextCursor: posts.length
        ? posts[posts.length - 1].createdAt.toISOString()
        : null,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "internal server error" });
  }
});


// Auth-protected: add a comment. Identity from the token.
router.post("/posts/:postId/comments", verifyFirebaseIdToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.uid;
    const { name, photo, text } = req.body;

    if (!postId) return res.status(400).json({ error: "postId required" });
    if (!text)
      return res.status(400).json({ error: "text required" });

    const comment = await PostComment.create({
      postId,
      author: { userId, name: name || "", photo: photo || "" },
      text,
    });

    // Notify the post author (unless they commented on their own post).
    const post = await PublicPost.findById(postId).lean();
    if (post && post.author && post.author.userId && post.author.userId !== userId) {
      await createNotification({
        userId: post.author.userId,
        title: `${name || 'Someone'} commented on your post`,
        message: text || 'View your post.',
        type: 'social',
        fromUser: userId,
        link: '/public',
        action: 'View',
        entityType: 'post_comment',
        entityId: String(comment._id),
      });
    }

    res.status(201).json(comment);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "internal server error" });
  }
});

// Auth-protected: delete own comment.
router.delete("/posts/:postId/comments/:commentId", verifyFirebaseIdToken, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user.uid;

    if (!postId || !commentId) {
      return res.status(400).json({ error: "postId and commentId required" });
    }

    const comment = await PostComment.findOne({ _id: commentId, postId, "author.userId": userId });
    if (!comment) {
      return res.status(404).json({ error: "Comment not found or you are not the author." });
    }

    await PostComment.deleteOne({ _id: comment._id });
    return res.json({ success: true, deleted: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "internal server error" });
  }
});

// Public (unauthenticated) comment browsing.
router.get("/posts/:postId/comments", async (req, res) => {
  try {
    const { postId } = req.params;
    const comments = await PostComment.find({ postId })
      .sort({ createdAt: 1 })
      .lean();

    res.json({ comments });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "internal server error" });
  }
});


// Auth-protected: toggle like. Identity from the token.
router.post("/posts/:postId/like", verifyFirebaseIdToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.uid;

    if (!postId) return res.status(400).json({ error: "postId required" });

    const existing = await PostLike.findOne({ postId, userId });

    if (existing) {
      await PostLike.deleteOne({ postId, userId });
      return res.json({ liked: false });
    }

    await PostLike.create({ postId, userId });

    // Notify the post author (unless they liked their own post).
    const post = await PublicPost.findById(postId).lean();
    if (post && post.author && post.author.userId && post.author.userId !== userId) {
      const profile = await require('../Model/UserProfile').findOne({ firebaseUid: userId }).lean();
      const likerName = profile?.name || profile?.username || 'Someone';
      await createNotification({
        userId: post.author.userId,
        title: `${likerName} liked your post`,
        message: 'Tap to view your post.',
        type: 'social',
        fromUser: userId,
        link: '/public',
        action: 'View',
        entityType: 'post_like',
        entityId: String(post._id),
      });
    }

    return res.json({ liked: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "internal server error" });
  }
});

// Auth-protected: delete own post.
router.delete("/posts/:postId", verifyFirebaseIdToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.uid;

    if (!postId) return res.status(400).json({ error: "postId required" });

    const post = await PublicPost.findOne({ _id: postId, "author.userId": userId });
    if (!post) {
      return res.status(404).json({ error: "Post not found or you are not the author." });
    }

    await Promise.all([
      PublicPost.deleteOne({ _id: post._id }),
      PostLike.deleteMany({ postId: post._id }),
      PostComment.deleteMany({ postId: post._id }),
    ]);

    return res.json({ success: true, deleted: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "internal server error" });
  }
});

// Public stats. `likedByMe` is only resolved when a valid token is present.
router.get("/posts/:postId/stats", async (req, res) => {
  try {
    const { postId } = req.params;

    const [likesCount, commentsCount] = await Promise.all([
      PostLike.countDocuments({ postId }),
      PostComment.countDocuments({ postId }),
    ]);

    let likedByMe = false;
    const header = req.headers.authorization;
    const hasBearer = !!header && header.startsWith("Bearer ");
    if (hasBearer) {
      try {
        const token = header.slice("Bearer ".length).trim();
        const { verifyFirebaseIdToken } = require("../middleware/authFirebase");
        // Reuse the middleware in "optional auth" mode by wrapping it.
        // We build a fake handler that only sets req.user on success.
        const next = () => {};
        // Simpler: decode token directly via admin.
        const { getAuthOrThrow } = require("../config/firebaseAdmin");
        const authService = getAuthOrThrow();
        const decoded = await authService.verifyIdToken(token);
        if (decoded && decoded.uid) {
          likedByMe = (await PostLike.findOne({ postId, userId: decoded.uid }))
            ? true
            : false;
        }
      } catch (e) {
        // Invalid/expired token -> treat as unauthenticated.
        likedByMe = false;
      }
    }

    res.json({ likesCount, commentsCount, likedByMe });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "internal server error" });
  }
});

// Auth-protected friends count for posting limits UX + backend rule enforcement.
router.get("/friends/count", verifyFirebaseIdToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    const friendsCount = await Friendship.countDocuments({
      userId,
      status: "accepted",
    });

    const allowedPerDay = computeAllowedPerDay(friendsCount);

    res.json({ friendsCount, allowedPerDay });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "internal server error" });
  }
});

// Auth-protected testing/seed endpoint: create an accepted friendship.
// DEV ONLY — disabled in production because it lets any authenticated user forge
// accepted friendships (with any friendId) and bypass the friend-based posting limits.
router.post("/friends/seed", verifyFirebaseIdToken, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: "Not found." });
  }
  try {
    const userId = req.user.uid;
    const { friendId } = req.body;
    if (!friendId)
      return res.status(400).json({ error: "friendId required" });

    const doc = await Friendship.create({
      userId,
      friendId,
      status: "accepted",
    });

    res.status(201).json(doc);
  } catch (err) {
    // duplicate key, etc.
    if (err && err.code === 11000) {
      return res
        .status(200)
        .json({ success: true, message: "friendship already exists" });
    }
    console.log(err);
    res.status(500).json({ error: "internal server error" });
  }
});

module.exports = router;
