const { pick, randInt, fakeDateWithinLastMonths } = require('../utils');

function sentence() {
  const parts = [
    'shipping features fast',
    'improving performance',
    'learning by building',
    'refactoring for maintainability',
    'designing clean APIs',
    'writing better tests',
    'collaborating across teams',
    'optimizing user experience',
    'handling edge cases',
  ];
  return `Today I’m focused on ${pick(parts)} and documenting learnings for the team.`;
}

function hashtags() {
  const pool = ['#Internship','#Internshala','#BuildInPublic','#React','#Nextjs','#Nodejs','#TypeScript','#MongoDB','#Frontend','#Backend','#MERN','#DataStructures','#Algorithms','#OpenSource'];
  const count = randInt(4, 7);
  return pool.sort(() => Math.random() - 0.5).slice(0, count).join(' ');
}

function generateCaption() {
  const cap = [sentence(), sentence(), hashtags()];
  const use = cap.sort(() => Math.random() - 0.5).slice(0, randInt(1, 3));
  return use.join(' ');
}

function generatePosts({ users, images = [] }, count = 12) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const author = pick(users);
    const mediaUrl = images.length ? pick(images) : `https://placehold.co/900x500/png?text=Post+${i + 1}`;
    const mediaType = images.length ? (mediaUrl.endsWith('.png') || mediaUrl.endsWith('.jpg') || mediaUrl.endsWith('.webp') ? 'image' : 'image') : 'image';

    out.push({
      author: { userId: author.userId, name: author.fullName, photo: author.profilePhoto },
      caption: generateCaption(),
      media: { mediaType, url: mediaUrl },
      createdAt: fakeDateWithinLastMonths(12),
    });
  }
  return out;
}

module.exports = { generatePosts };

