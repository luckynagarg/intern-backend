const express = require("express");
const router = express.Router();

const PublicPost = require("../Model/PublicPost");
const PostComment = require("../Model/PostComment");
const PostLike = require("../Model/PostLike");
const Friendship = require("../Model/Friendship");
const DailyPostLimit = require("../Model/DailyPostLimit");

function getTodayYMD() {
  const d = new Date();
   const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function computeAllowedPerDay(friendsCount) {
  if (!friendsCount || friendsCount <= 0) return 0;
  if (friendsCount === 1) return 1;
  if (friendsCount === 2) return 2;
  if (friendsCount > 10) return Number.POSITIVE_INFINITY;
  // 3..10
  return Math.min(friendsCount, 10);
}

router.post("/posts", async (req, res) => {
  try {
    const { userId, name, photo, caption, mediaUrl, mediaType } = req.body;

    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!mediaUrl || !mediaType)
      return res.status(400).json({ error: "mediaUrl and mediaType required" });

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

    const post = await PublicPost.create({
      author: { userId, name: name || "", photo: photo || "" },
      caption: caption || "",
      media: { mediaType, url: mediaUrl },
    });

    return res.status(201).json(post);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

router.get("/posts", async (req, res) => {
  try {
    
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 50);
    const cursor = req.query.cursor;
    const userId = req.query.userId;

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


router.post("/posts/:postId/comments", async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId, name, photo, text } = req.body;

    if (!postId) return res.status(400).json({ error: "postId required" });
    if (!userId || !text)
      return res.status(400).json({ error: "userId and text required" });

    const comment = await PostComment.create({
      postId,
      author: { userId, name: name || "", photo: photo || "" },
      text,
    });

    res.status(201).json(comment);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "internal server error" });
  }
});

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


router.post("/posts/:postId/like", async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId } = req.body;

    if (!postId) return res.status(400).json({ error: "postId required" });
    if (!userId) return res.status(400).json({ error: "userId required" });

    const existing = await PostLike.findOne({ postId, userId });

    if (existing) {
      await PostLike.deleteOne({ postId, userId });
      return res.json({ liked: false });
    }

    await PostLike.create({ postId, userId });
    return res.json({ liked: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "internal server error" });
  }
});

router.get("/posts/:postId/stats", async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId } = req.query;

    const [likesCount, commentsCount] = await Promise.all([
      PostLike.countDocuments({ postId }),
      PostComment.countDocuments({ postId }),
    ]);

    let likedByMe = false;
    if (userId) {
      likedByMe = (await PostLike.findOne({ postId, userId })) ? true : false;
    }

    res.json({ likesCount, commentsCount, likedByMe });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "internal server error" });
  }
});

// Minimal friends count endpoint for posting limits UX + backend rule enforcement
router.get("/friends/count", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });

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

// Testing/seed-friendly endpoint: create an accepted friendship
router.post("/friends/seed", async (req, res) => {
  try {
    const { userId, friendId } = req.body;
    if (!userId || !friendId)
      return res.status(400).json({ error: "userId and friendId required" });

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

