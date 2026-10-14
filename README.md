# Read Me – Book Store

## Run it
1. Start MongoDB.
2. `npm install`
3. Edit `.env` (admin password, store name, currency)
4. `npm run seed`   (optional: adds 6 demo books to an EMPTY database)
5. `npm run dev`    → http://localhost:3000

Admin panel: click **Admin panel** in the top menu (or open /admin). Login is in `.env`.

## In the admin panel you can
- Add a new book (title, author, price, category, description, picture, "Featured" tick)
- Edit ANY detail of any book
- Remove a book
- See orders (change status) and customer messages

## Files
- `index.js`  – all pages, cart, checkout and admin
- `models.js` – Book, Order, Message
- `views/`    – pages (`includes/` = header, footer, book card; `admin/` = admin pages)
- `public/css/style.css` – all styling (colors at the top)
- `public/banners/` – home page pictures
