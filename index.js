require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { Book, Order, Message } = require('./models');

/* ---------- settings (from the .env file) ---------- */
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bookstore';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || '1234';
const STORE = process.env.STORE_NAME || 'Read Me';
const CURRENCY = process.env.CURRENCY || '₹';

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));       // full paths: works from any folder
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
// Express 5 leaves req.body undefined when a form sends no data (e.g. the Add to cart button)
app.use((req, res, next) => { req.body = req.body || {}; next(); });
app.use(session({
  secret: process.env.SESSION_SECRET || 'bookstoresecret',
  resave: false,
  saveUninitialized: false,
}));

/* ---------- helpers ---------- */

// IMAGE ADDRESS FIX: always gives a correct image URL that starts with "/".
// Without the "/", the browser looks for the picture relative to the page URL
// (e.g. /books/edit/uploads/x.jpg) and the image breaks.
function imgSrc(img) {
  if (!img) return '/default-book-cover.svg';             // book has no image
  if (/^https?:\/\//i.test(img)) return img;              // full web address
  return '/' + String(img).replace(/^\/+/, '');           // make sure there is exactly one "/"
}
const money = (n) => CURRENCY + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const isId = (id) => /^[0-9a-fA-F]{24}$/.test(String(id)); // stops "CastError" for ids like "abc"
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const flash = (req, text) => { req.session.flash = text; };

// Categories with how many books each has: [{ name: 'Fantasy', count: 3 }, ...]
async function categoryList() {
  const rows = await Book.find({}, 'category').lean();
  const map = {};
  rows.forEach((r) => { if (r.category) map[r.category] = (map[r.category] || 0) + 1; });
  return Object.keys(map).sort().map((name) => ({ name, count: map[name] }));
}

// Every page can use these variables
app.use((req, res, next) => {
  const cart = req.session.cart || {};
  res.locals.store = STORE;
  res.locals.currentPath = req.path;
  res.locals.money = money;
  res.locals.imgSrc = imgSrc;
  res.locals.isAdmin = Boolean(req.session.isAdmin);
  res.locals.cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  res.locals.flash = req.method === 'GET' ? req.session.flash : null;
  if (res.locals.flash) delete req.session.flash;
  next();
});

/* ---------- picture upload ---------- */
const UPLOADS = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });               // create the folder if it is missing
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + EXT[file.mimetype]),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },                  // max 3 MB
  fileFilter: (req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP or GIF pictures are allowed'))),
});
// A wrong file gives a message on the form instead of crashing
const uploadPicture = (req, res, next) => upload.single('img')(req, res, (err) => {
  if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Picture is too large (max 3 MB)' : err.message;
  next();
});

/* ---------- shop pages ---------- */

app.get('/', async (req, res) => {
  const [featured, categories, total] = await Promise.all([
    Book.find({ featured: true }).sort({ _id: -1 }).limit(4).lean(),
    categoryList(),
    Book.countDocuments(),
  ]);
  // "New arrivals" skips the books already shown under "Featured"
  const latest = await Book.find({ _id: { $nin: featured.map((b) => b._id) } }).sort({ _id: -1 }).limit(8).lean();
  res.render('home', { title: 'Home', latest, featured, categories, total });
});

app.get('/books', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = q ? { $or: ['title', 'author', 'category'].map((f) => ({ [f]: new RegExp(escapeRegex(q), 'i') })) } : {};
  const books = await Book.find(filter).sort({ _id: -1 }).lean();
  res.render('books', { title: 'Books', books, q });
});

// One book with its description
app.get('/book/:id', async (req, res, next) => {
  const book = isId(req.params.id) ? await Book.findById(req.params.id).lean() : null;
  if (!book) return next();
  const related = await Book.find({ category: book.category, _id: { $ne: book._id } }).limit(4).lean();
  res.render('book', { title: book.title, book, related });
});

app.get('/category', async (req, res) => {
  const [categories, books] = await Promise.all([categoryList(), Book.find().sort({ _id: -1 }).lean()]);
  res.render('categories', { title: 'Categories', categories, books, active: '' });
});

app.get('/category/:name', async (req, res) => {
  const [categories, books] = await Promise.all([
    categoryList(),
    Book.find({ category: new RegExp('^' + escapeRegex(req.params.name) + '$', 'i') }).sort({ _id: -1 }).lean(),
  ]);
  res.render('categories', { title: req.params.name, categories, books, active: req.params.name });
});

app.get('/about', (req, res) => res.render('about', { title: 'About' }));

/* ---------- cart: stored in the session as { bookId: quantity } ---------- */

async function getCart(req) {
  const saved = req.session.cart || {};
  const ids = Object.keys(saved).filter(isId);
  const books = ids.length ? await Book.find({ _id: { $in: ids } }).lean() : [];
  const items = books.map((book) => ({ book, qty: saved[book._id], line: book.price * saved[book._id] }));
  // forget books that the admin deleted
  req.session.cart = Object.fromEntries(items.map((i) => [i.book._id, i.qty]));
  return { items, total: items.reduce((sum, i) => sum + i.line, 0) };
}

// Add to cart (stay on the page) and Buy now (go to checkout) both use this
app.post('/cart/add/:id', async (req, res) => {
  const book = isId(req.params.id) ? await Book.findById(req.params.id).lean() : null;
  if (!book) { flash(req, 'Sorry, this book is no longer available.'); return res.redirect('/books'); }

  const cart = req.session.cart || {};
  const id = String(book._id);
  if (req.body.buy) {
    cart[id] = cart[id] || 1;                             // Buy now: at least 1, then checkout
    req.session.cart = cart;
    return res.redirect('/checkout');
  }
  cart[id] = Math.min(20, (cart[id] || 0) + 1);           // Add to cart: +1 each click
  req.session.cart = cart;
  flash(req, '"' + book.title + '" added to your cart.');
  const back = req.get('referer');
  res.redirect(back && back.includes(req.get('host')) ? back : '/books');
});

app.get('/cart', async (req, res) => res.render('cart', { title: 'Cart', cart: await getCart(req) }));

app.post('/cart/update/:id', (req, res) => {
  const cart = req.session.cart || {};
  const qty = parseInt(req.body.qty, 10);
  if (cart[req.params.id]) {
    if (qty > 0) cart[req.params.id] = Math.min(20, qty); else delete cart[req.params.id];
  }
  req.session.cart = cart;
  res.redirect('/cart');
});

app.post('/cart/remove/:id', (req, res) => {
  if (req.session.cart) delete req.session.cart[req.params.id];
  res.redirect('/cart');
});

/* ---------- checkout (pay on delivery) ---------- */

app.get('/checkout', async (req, res) => {
  const cart = await getCart(req);
  if (!cart.items.length) { flash(req, 'Your cart is empty. Add a book first.'); return res.redirect('/books'); }
  res.render('checkout', { title: 'Checkout', cart, v: {}, error: '' });
});

app.post('/checkout', async (req, res) => {
  const cart = await getCart(req);
  if (!cart.items.length) return res.redirect('/books');

  const v = {};
  ['name', 'phone', 'address', 'city', 'pincode'].forEach((k) => { v[k] = String(req.body[k] || '').trim().slice(0, 300); });
  const missing = Object.keys(v).filter((k) => !v[k]);
  if (missing.length || !/^[+\d][\d\s-]{6,17}$/.test(v.phone)) {
    const error = missing.length ? 'Please fill in all the fields.' : 'Please enter a valid phone number.';
    return res.status(400).render('checkout', { title: 'Checkout', cart, v, error });
  }

  // the price always comes from the database, never from the browser
  const order = await Order.create({
    ...v,
    orderNo: 'RM' + Date.now().toString(36).toUpperCase(),
    items: cart.items.map((i) => ({ title: i.book.title, price: i.book.price, qty: i.qty })),
    total: cart.total,
  });
  req.session.cart = {};
  req.session.lastOrder = order.orderNo;
  res.redirect('/order/' + order.orderNo);
});

app.get('/order/:no', async (req, res, next) => {
  if (req.session.lastOrder !== req.params.no) return next();   // only the buyer can see it
  const order = await Order.findOne({ orderNo: req.params.no }).lean();
  if (!order) return next();
  res.render('order', { title: 'Order placed', order });
});

/* ---------- contact ---------- */

app.get('/contact', (req, res) => res.render('contact', { title: 'Contact', v: {}, error: '' }));

app.post('/contact', async (req, res) => {
  const v = {};
  ['name', 'email', 'phone', 'message'].forEach((k) => { v[k] = String(req.body[k] || '').trim().slice(0, 2000); });
  if (!v.name || !v.message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) {
    return res.status(400).render('contact', { title: 'Contact', v, error: 'Please enter your name, a valid email and a message.' });
  }
  await Message.create(v);                                 // always saved, so it is never lost
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {   // email is optional
    try {
      await nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
        connectionTimeout: 10000,
      }).sendMail({
        to: process.env.CONTACT_TO || process.env.GMAIL_USER,
        replyTo: v.email,
        subject: 'New customer message',
        text: `Name: ${v.name}\nEmail: ${v.email}\nPhone: ${v.phone}\n\n${v.message}`,
      });
    } catch (err) { console.log('Email not sent:', err.message); }
  }
  flash(req, 'Thank you! Your message has been sent.');
  res.redirect('/contact');
});

/* ---------- admin ---------- */

const needAdmin = (req, res, next) => (req.session.isAdmin ? next() : res.redirect('/admin/login'));

app.get('/admin/login', (req, res) => res.render('admin/login', { title: 'Admin login', error: '' }));

app.post('/admin/login', (req, res) => {
  if (req.body.username === ADMIN_USER && req.body.password === ADMIN_PASS) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.status(401).render('admin/login', { title: 'Admin login', error: 'Wrong username or password.' });
});

app.get('/admin/logout', (req, res) => { delete req.session.isAdmin; res.redirect('/'); });

app.get('/admin', needAdmin, async (req, res) => {
  const books = await Book.find().sort({ _id: -1 }).lean();
  res.render('admin/books', { title: 'Manage books', books });
});

app.get('/admin/books/new', needAdmin, async (req, res) => {
  res.render('admin/form', { title: 'Add book', book: {}, isEdit: false, error: '', cats: await Book.distinct('category') });
});

// one function saves both "add" and "edit"
async function saveBook(req, res, book, isEdit) {
  book.set({
    title: req.body.title, author: req.body.author, category: req.body.category,
    description: req.body.description,
    featured: Boolean(req.body.featured),                       // tick box
    price: req.body.price === '' ? undefined : Number(req.body.price),
  });
  if (req.file) book.img = '/uploads/' + req.file.filename;     // always saved WITH the leading "/"
  try {
    if (req.uploadError) throw new Error(req.uploadError);
    await book.save();
  } catch (err) {
    const error = err.errors ? Object.values(err.errors).map((e) => (e.name === 'CastError' ? 'Price must be a number' : e.message)).join('. ') : err.message;
    return res.status(400).render('admin/form', { title: isEdit ? 'Edit book' : 'Add book', book: book.toObject(), isEdit, error, cats: await Book.distinct('category') });
  }
  flash(req, isEdit ? 'Book updated.' : 'Book added.');
  res.redirect('/admin');
}

app.post('/admin/books', needAdmin, uploadPicture, (req, res) => saveBook(req, res, new Book(), false));

app.get('/admin/books/:id/edit', needAdmin, async (req, res, next) => {
  const book = isId(req.params.id) ? await Book.findById(req.params.id).lean() : null;
  if (!book) return next();                                       // missing book -> 404 page (old code crashed)
  res.render('admin/form', { title: 'Edit book', book, isEdit: true, error: '', cats: await Book.distinct('category') });
});

app.post('/admin/books/:id', needAdmin, uploadPicture, async (req, res, next) => {
  const book = isId(req.params.id) ? await Book.findById(req.params.id) : null;
  if (!book) return next();
  saveBook(req, res, book, true);
});

app.post('/admin/books/:id/delete', needAdmin, async (req, res) => {
  if (isId(req.params.id)) await Book.findByIdAndDelete(req.params.id);
  flash(req, 'Book deleted.');
  res.redirect('/admin');
});

app.get('/admin/orders', needAdmin, async (req, res) => {
  const orders = await Order.find().sort({ _id: -1 }).lean();
  res.render('admin/orders', { title: 'Orders', orders, statuses: Order.schema.path('status').enumValues });
});

app.post('/admin/orders/:id/status', needAdmin, async (req, res) => {
  if (isId(req.params.id) && Order.schema.path('status').enumValues.includes(req.body.status)) {
    await Order.updateOne({ _id: req.params.id }, { status: req.body.status });
  }
  res.redirect('/admin/orders');
});

app.get('/admin/messages', needAdmin, async (req, res) => {
  const messages = await Message.find().sort({ _id: -1 }).lean();
  res.render('admin/messages', { title: 'Messages', messages });
});

app.post('/admin/messages/:id/delete', needAdmin, async (req, res) => {
  if (isId(req.params.id)) await Message.findByIdAndDelete(req.params.id);
  res.redirect('/admin/messages');
});

// old admin links still work
app.get('/books/new', (req, res) => res.redirect('/admin/books/new'));
app.get('/books/edit/:id', (req, res) => res.redirect('/admin/books/' + encodeURIComponent(req.params.id) + '/edit'));

/* ---------- 404 and errors ---------- */

app.use((req, res) => res.status(404).render('error', { title: 'Not found', code: 404, message: 'Sorry, that page was not found.' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err);
  const dbDown = /buffering timed out|ECONNREFUSED|ServerSelection|not connected/i.test(err.name + err.message);
  const code = dbDown ? 503 : 500;
  const message = dbDown ? 'The database is not reachable right now. Please try again in a moment.' : 'Something went wrong. Please try again.';
  try { res.status(code).render('error', { title: 'Error', code, message }); }
  catch (e) { res.status(code).send(message); }
});

/* ---------- start: connect to the database FIRST, then open the website ---------- */
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 })
  .then(() => {
    console.log('Database connected:', mongoose.connection.name);
    app.listen(PORT,"0.0.0.0", () =>
      console.log('Website running at http://localhost:' + PORT));
  })
  .catch((err) => {
    console.error('Could not connect to MongoDB:', err.message);
    console.error('Start MongoDB and check MONGODB_URI in the .env file.');
    process.exit(1);
  });
