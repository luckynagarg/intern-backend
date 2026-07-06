const { pick, randInt } = require('../utils');

function generateLikes({ users, posts, likeMin = 0, likeMax = 20 }) {
  const out = [];
  const existing = new Set();

  for (const post of posts) {
    const count = randInt(likeMin, likeMax);
    for (let i = 0; i < count; i++) {
      const user = pick(users);
      const key = `${post._id}-${user.userId}`;
      if (existing.has(key)) continue;
      existing.add(key);
      out.push({ postId: String(post._id), userId: user.userId });
    }
  }

  return out;
}

function generateComments({ users, posts, commentMin = 1, commentMax = 10 }) {
  const out = [];

  const commentTemplates = [
    'This looks great—nice work!',
    'Thanks for sharing! Very helpful.',
    'How did you handle the edge cases?',
    'Love the approach. Clean and practical.',
    'Impressive progress—keep it up!',
    'What tech stack did you use?',
    'Great explanation. Learned something new.',
    'Can you share more details about this part?',
  ];

  for (const post of posts) {
    const count = randInt(commentMin, commentMax);
    for (let i = 0; i < count; i++) {
      const user = pick(users);
      out.push({
        postId: String(post._id),
        author: { userId: user.userId, name: user.fullName, photo: user.profilePhoto },
        text: pick(commentTemplates),
        createdAt: new Date(),
      });
    }
  }

  return out;
}

module.exports = { generateLikes, generateComments };

