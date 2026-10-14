const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  title:       { type: String, required: [true, 'Title is required'], trim: true, maxlength: [150, 'Title is too long'] },
  author:      { type: String, required: [true, 'Author is required'], trim: true, maxlength: [100, 'Author name is too long'] },
  price:       { type: Number, required: [true, 'Price is required'], min: [0, 'Price cannot be negative'], max: [1000000, 'Price is too high'] },
  category:    { type: String, required: [true, 'Category is required'], trim: true, maxlength: [50, 'Category is too long'] },
  description: { type: String, trim: true, default: '', maxlength: [1500, 'Description is too long (max 1500 characters)'] },
  featured:    { type: Boolean, default: false },      // shown in the "Featured" part of the home page
  img:         { type: String, default: '' },
}, { timestamps: true });

// "fantasy", " FANTASY " and "Fantasy" all become "Fantasy" (so a category is not listed twice)
bookSchema.pre('validate', function () {
  if (typeof this.category === 'string') {
    this.category = this.category.trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  }
});

const Book = mongoose.model('Book', bookSchema);

const Order = mongoose.model('Order', new mongoose.Schema({
  orderNo:  String,
  name: String, phone: String, address: String, city: String, pincode: String,
  // title and price are copied here, so old orders stay correct if a book changes later
  items:    [{ title: String, price: Number, qty: Number }],
  total:    Number,
  status:   { type: String, default: 'Pending', enum: ['Pending', 'Shipped', 'Delivered', 'Cancelled'] },
}, { timestamps: true }));

const Message = mongoose.model('Message', new mongoose.Schema({
  name: String, email: String, phone: String, message: String,
}, { timestamps: true }));

module.exports = { Book, Order, Message };
