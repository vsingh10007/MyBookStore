// Adds 6 demo books when the database is EMPTY.   Run:  npm run seed
require('dotenv').config();
const mongoose = require('mongoose');
const { Book } = require('./models');

const demo = [
  { title: 'The Alchemist', author: 'Paulo Coelho', price: 299, category: 'Fiction', featured: true, img: '/uploads/1790874952976-a.webp',
    description: 'A shepherd boy sets out to follow his dream and learns that the journey matters as much as the treasure. A gentle, inspiring story about listening to your heart.' },
  { title: 'Atomic Habits', author: 'James Clear', price: 499, category: 'Self Help', featured: true, img: '/uploads/AH.jpg',
    description: 'A practical guide to building good habits and breaking bad ones, showing how tiny daily changes add up to remarkable results.' },
  { title: 'The Hobbit', author: 'J.R.R. Tolkien', price: 399, category: 'Fantasy', featured: true, img: '/uploads/1790875569514-h.webp',
    description: 'Bilbo Baggins leaves his quiet home to join a band of dwarves on a dangerous adventure full of dragons, riddles and treasure.' },
  { title: "Harry Potter and the Philosopher's Stone", author: 'J.K. Rowling', price: 450, category: 'Fantasy', featured: true, img: '/uploads/HP.jpg',
    description: 'A boy discovers on his eleventh birthday that he is a wizard, and begins his first year at a school of magic.' },
  { title: 'The Secret', author: 'Rhonda Byrne', price: 349, category: 'Self Help', img: '/uploads/1790270705283-s.jpg',
    description: 'A popular self-help book about positive thinking and how our thoughts can shape our lives.' },
  { title: 'The Lord of the Rings', author: 'J.R.R. Tolkien', price: 799, category: 'Fantasy', img: '/img3.png',
    description: 'The epic tale of a small group on a great quest to destroy a powerful ring and save Middle-earth.' },
];

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bookstore', { serverSelectionTimeoutMS: 8000 })
  .then(async () => {
    if (await Book.countDocuments()) console.log('Database already has books. Nothing added.');
    else { await Book.insertMany(demo); console.log('Added', demo.length, 'demo books.'); }
  })
  .catch((e) => { console.error('Seed failed:', e.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
