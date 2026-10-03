const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, {recursive:true});
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-this-secret';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@devchulimultiplex.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeThisPassword123!';
const DEFAULT_TICKET_URL = process.env.TICKET_URL || 'https://www.inicinemas.com';
const DEFAULT_VAT = Number(process.env.VAT_RATE || 13);

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.urlencoded({extended:true, limit:'1mb'}));
app.use(express.json({limit:'1mb'}));
app.set('trust proxy', 1);
app.use(session({secret:SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}}));
app.use('/uploads', express.static(path.join(DATA_DIR,'uploads')));
app.use('/static', express.static(path.join(__dirname,'public')));

const db = new Database(path.join(DATA_DIR,'devchuli.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'CUSTOMER',active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS businesses(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,slug TEXT UNIQUE NOT NULL,description TEXT DEFAULT '',logo_url TEXT DEFAULT '',cover_url TEXT DEFAULT '',phone TEXT DEFAULT '',address TEXT DEFAULT '',website TEXT DEFAULT '',pricing_mode TEXT NOT NULL DEFAULT 'FIXED',active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS news(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,body TEXT NOT NULL,image_url TEXT DEFAULT '',scope TEXT NOT NULL DEFAULT 'GLOBAL',business_id INTEGER,active INTEGER NOT NULL DEFAULT 1,published_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(business_id) REFERENCES businesses(id));
CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,name TEXT NOT NULL,category TEXT DEFAULT '',description TEXT DEFAULT '',photo_url TEXT DEFAULT '',price REAL NOT NULL DEFAULT 0,vat_included INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1,FOREIGN KEY(business_id) REFERENCES businesses(id));
CREATE TABLE IF NOT EXISTS pricing(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,label TEXT NOT NULL,minutes INTEGER,base_price REAL NOT NULL DEFAULT 0,increment_minutes INTEGER,price_per_increment REAL,active INTEGER NOT NULL DEFAULT 1,FOREIGN KEY(business_id) REFERENCES businesses(id));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,user_email TEXT,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

function setting(key, fallback='') {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key,value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));
}
function slugify(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function audit(req,action,entity,id='') { db.prepare('INSERT INTO audit_logs(user_email,action,entity,entity_id) VALUES(?,?,?,?)').run(req.session.user?.email||'system',action,entity,String(id)); }
function isAdmin(req,res,next) {
  if (!req.session.user || !['SUPER_ADMIN','ADMIN'].includes(req.session.user.role)) return res.redirect('/admin/login');
  next();
}
function esc(s='') { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function layout(title,body,admin=false) {
  const nav = admin ? `<nav class="nav"><a class="brand" href="/admin">DEVCHULI ADMIN</a><div><a href="/">Customer App</a>　<a href="/admin/logout">Logout</a></div></nav>` :
    `<nav class="nav"><a class="brand" href="/">DEVCHULI MULTIPLEX</a><div><a href="/#businesses">Businesses</a>　<a href="/admin/login">Super Admin</a></div></nav>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#111827"><link rel="manifest" href="/static/manifest.webmanifest"><link rel="icon" href="/static/icon.svg"><script>if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/static/sw.js').catch(()=>{}));}</script><title>${esc(title)}</title><link rel="stylesheet" href="/static/style.css"></head><body>${nav}${body}<footer>© ${new Date().getFullYear()} Devchuli Multiplex</footer></body></html>`;
}
function durationLabel(minutes) {
  if (minutes % 60 === 0) return `${minutes/60} hr`;
  if (minutes > 60) return `${Math.floor(minutes/60)} hr ${minutes%60} min`;
  return `${minutes} min`;
}
function generateOptions(interval,price,count=10) {
  return Array.from({length:count},(_,i)=>({minutes:(i+1)*interval,label:durationLabel((i+1)*interval),price:(i+1)*price}));
}
function money(n) { return 'Rs. ' + Number(n||0).toFixed(2); }
function vatInclusive(total,rate) { return {net:total/(1+rate/100),vat:total-total/(1+rate/100),total}; }

(async()=>{
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(ADMIN_EMAIL);
  if (!existing) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD,12);
    db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run('Super Admin',ADMIN_EMAIL,hash,'SUPER_ADMIN');
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM businesses').get().n;
  if (!count) {
    const insert = db.prepare('INSERT INTO businesses(name,slug,description,pricing_mode) VALUES(?,?,?,?)');
    [
      ['Cinema','cinema','INI Cinemas information and external ticket link','FIXED'],
      ['Swimming Pool','swimming-pool','Swimming pool information and configurable pricing','CUSTOM'],
      ['Children Park','children-park','Children Park and time-based pricing','TIME_BASED'],
      ['Food & Cafe','food-cafe','Food menu, offers and services','QUANTITY_BASED'],
      ['Mart','mart','Mart products and offers','QUANTITY_BASED'],
      ['Tours & Travels','tours-travels','Tours and travel services','CUSTOM']
    ].forEach(x=>insert.run(...x));
    const park = db.prepare("SELECT id FROM businesses WHERE slug='children-park'").get();
    db.prepare('INSERT INTO pricing(business_id,label,increment_minutes,price_per_increment,base_price) VALUES(?,?,?,?,?)').run(park.id,'Time interval',20,50,50);
  }
  if (!setting('buy_ticket_url')) setSetting('buy_ticket_url',DEFAULT_TICKET_URL);
  if (!setting('vat_rate')) setSetting('vat_rate',DEFAULT_VAT);
  if (!setting('devchuli_name')) setSetting('devchuli_name','Devchuli Multiplex');
})();

const uploadDir=path.join(DATA_DIR,'uploads');
fs.mkdirSync(uploadDir,{recursive:true});
const storage=multer.diskStorage({destination:(req,file,cb)=>cb(null,uploadDir),filename:(req,file,cb)=>cb(null,Date.now()+'-'+Math.random().toString(36).slice(2)+path.extname(file.originalname).toLowerCase())});
const upload=multer({storage,limits:{fileSize:5*1024*1024},fileFilter:(req,file,cb)=>{if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype))return cb(new Error('Only image files are allowed'));cb(null,true);}});

app.get('/',(req,res)=>{
  const businesses=db.prepare('SELECT * FROM businesses WHERE active=1 ORDER BY name').all();
  const news=db.prepare("SELECT n.*,b.name AS business_name FROM news n LEFT JOIN businesses b ON b.id=n.business_id WHERE n.active=1 AND n.scope='GLOBAL' AND datetime(n.published_at)>=datetime('now','-24 hours') ORDER BY n.published_at DESC LIMIT 20").all();
  const ticket=setting('buy_ticket_url',DEFAULT_TICKET_URL);
  const cards=businesses.map(b=>`<a class="card" href="/business/${esc(b.slug)}">${b.cover_url?`<img class="cover" src="${esc(b.cover_url)}">`:''}<h3>${esc(b.name)}</h3><p>${esc(b.description)}</p><span class="muted">View details →</span></a>`).join('');
  const newsHtml=news.length?news.map(n=>`<article class="card">${n.image_url?`<img class="newsimg" src="${esc(n.image_url)}">`:''}<small>${esc(n.published_at)}</small><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></article>`).join(''):'<div class="card"><h3>Welcome to Devchuli Multiplex</h3><p>Latest announcements and offers will appear here.</p></div>';
  const cinema=db.prepare("SELECT * FROM businesses WHERE slug='cinema' AND active=1").get();
  res.send(layout('Devchuli Multiplex',`<main class="container"><section class="hero"><span class="pill">ALL IN ONE DESTINATION</span><h1>Discover Devchuli Multiplex</h1><p>Entertainment, recreation, food, shopping and travel services in one place.</p><a class="btn primary" href="${esc(ticket)}" target="_blank" rel="noopener noreferrer">BUY TICKET ↗</a></section>
  <section><div class="sectionhead"><h2>Latest News · Last 24 Hours</h2></div><div class="grid">${newsHtml}</div></section>
  <section id="businesses"><div class="sectionhead"><h2>Our Businesses</h2><span class="muted">Choose a destination</span></div><div class="grid">${cards||'<p>No active businesses yet.</p>'}</div></section>
  ${cinema?`<section class="card cinema"><div><p class="pill">CINEMA</p><h2>INI CINEMAS × DEVCHULI MULTIPLEX</h2><p>Movie tickets are handled on the official INI Cinemas website.</p></div><a class="btn primary" href="${esc(ticket)}" target="_blank" rel="noopener noreferrer">BUY TICKET</a></section>`:''}</main>`));
});

app.get('/business/:slug',(req,res)=>{
  const b=db.prepare('SELECT * FROM businesses WHERE slug=? AND active=1').get(req.params.slug);
  if(!b) return res.status(404).send(layout('Not Found','<main class="container"><h1>Business not found</h1><a href="/">Return home</a></main>'));
  const news=db.prepare('SELECT * FROM news WHERE active=1 AND scope="BUSINESS" AND business_id=? ORDER BY published_at DESC LIMIT 20').all(b.id);
  const services=db.prepare('SELECT * FROM services WHERE active=1 AND business_id=? ORDER BY name').all(b.id);
  const price=db.prepare('SELECT * FROM pricing WHERE active=1 AND business_id=? ORDER BY id LIMIT 1').get(b.id);
  let pricingHtml='';
  if(price?.increment_minutes && price?.price_per_increment) pricingHtml=`<section><h2>Pricing</h2><div class="grid">${generateOptions(price.increment_minutes,price.price_per_increment,10).map(o=>`<div class="card"><b>${o.label}</b><p class="price">${money(o.price)}</p></div>`).join('')}</div></section>`;
  else if(price) pricingHtml=`<section class="card"><h2>Pricing</h2><p>${esc(price.label)}: ${money(price.base_price)}</p></section>`;
  const serviceHtml=services.map(s=>`<div class="card">${s.photo_url?`<img class="productimg" src="${esc(s.photo_url)}">`:''}<h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><strong>${money(s.price)}</strong></div>`).join('');
  const newsHtml=news.map(n=>`<article class="card">${n.image_url?`<img class="newsimg" src="${esc(n.image_url)}">`:''}<h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></article>`).join('');
  const cinema=b.slug==='cinema'?`<section class="card"><h2>INI CINEMAS</h2><p>Cinema tickets are booked externally.</p><a class="btn primary" href="${esc(setting('buy_ticket_url',DEFAULT_TICKET_URL))}" target="_blank" rel="noopener noreferrer">BUY TICKET</a></section>`:'';
  res.send(layout(b.name,`<main class="container"><a href="/">← Home</a><section class="hero">${b.cover_url?`<img class="businesscover" src="${esc(b.cover_url)}">`:''}<h1>${esc(b.name)}</h1><p>${esc(b.description)}</p>${b.address?`<p>${esc(b.address)}</p>`:''}${b.phone?`<p>Phone: ${esc(b.phone)}</p>`:''}${b.website?`<p><a href="${esc(b.website)}" target="_blank" rel="noopener noreferrer">Website ↗</a></p>`:''}</section>${cinema}${pricingHtml}
  ${serviceHtml?`<section><h2>Services / Menu</h2><div class="grid">${serviceHtml}</div></section>`:''}
  <section><h2>Business News</h2><div class="grid">${newsHtml||'<div class="card"><p class="muted">No business news published yet.</p></div>'}</div></section></main>`));
});

app.get('/admin/login',(req,res)=>{
  if(req.session.user) return res.redirect('/admin');
  const err=req.query.error?'<p class="error">Email or password is incorrect.</p>':'';
  res.send(layout('Super Admin Login',`<main class="container narrow"><form class="card form" method="post" action="/admin/login"><span class="pill">SECURE ADMIN ACCESS</span><h1>Super Admin Login</h1>${err}<label>Email</label><input name="email" type="email" required autocomplete="username"><label>Password</label><input name="password" type="password" required autocomplete="current-password"><button class="btn primary full">LOGIN</button><p class="muted small">Admin access is protected by server-side authentication.</p></form></main>`));
});
app.post('/admin/login',async(req,res)=>{
  const user=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(String(req.body.email||'').trim().toLowerCase());
  if(!user || !(await bcrypt.compare(String(req.body.password||''),user.password_hash))) return res.redirect('/admin/login?error=1');
  req.session.regenerate(err=>{if(err)return res.status(500).send('Could not start session');req.session.user={id:user.id,name:user.name,email:user.email,role:user.role};audit(req,'LOGIN','USER',user.id);res.redirect('/admin');});
});
app.get('/admin/logout',(req,res)=>{if(req.session.user)audit(req,'LOGOUT','USER',req.session.user.id);req.session.destroy(()=>res.redirect('/'));});

app.get('/admin',isAdmin,(req,res)=>{
 const counts={businesses:db.prepare('SELECT COUNT(*) n FROM businesses').get().n,active:db.prepare('SELECT COUNT(*) n FROM businesses WHERE active=1').get().n,news:db.prepare('SELECT COUNT(*) n FROM news').get().n,services:db.prepare('SELECT COUNT(*) n FROM services').get().n,users:db.prepare('SELECT COUNT(*) n FROM users').get().n};
 const links=[['Businesses','/admin/businesses'],['News Feed','/admin/news'],['Pricing','/admin/pricing'],['Food & Services','/admin/services'],['Branding & Images','/admin/branding'],['BUY TICKET URL','/admin/settings'],['VAT & Settings','/admin/settings'],['Users & Roles','/admin/users'],['Audit Logs','/admin/logs']];
 res.send(layout('Admin Dashboard',`<main class="container"><div class="sectionhead"><div><span class="pill">MANAGEMENT</span><h1>Welcome, ${esc(req.session.user.name)}</h1></div><span class="muted">${esc(req.session.user.role)}</span></div><div class="grid stats">${Object.entries(counts).map(([k,v])=>`<div class="card"><p class="muted">${esc(k)}</p><h2>${v}</h2></div>`).join('')}</div><h2>Management Modules</h2><div class="grid">${links.map(([n,u])=>`<a class="card" href="${u}"><h3>${n}</h3><p class="muted">Manage ${n.toLowerCase()} →</p></a>`).join('')}</div></main>`,true));
});

app.get('/admin/businesses',isAdmin,(req,res)=>{
 const rows=db.prepare('SELECT * FROM businesses ORDER BY id DESC').all();
 const form=`<form class="card form" method="post" action="/admin/businesses"><h2>Add Business</h2><label>Name</label><input name="name" required><label>Description</label><textarea name="description"></textarea><label>Pricing Mode</label><select name="pricing_mode"><option>FIXED</option><option>TIME_BASED</option><option>QUANTITY_BASED</option><option>CUSTOM</option></select><button class="btn primary">Add Business</button></form>`;
 const table=`<div class="card tablewrap"><table><thead><tr><th>Business</th><th>Slug</th><th>Mode</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(b=>`<tr><td><b>${esc(b.name)}</b><br><small>${esc(b.description)}</small></td><td>${esc(b.slug)}</td><td>${esc(b.pricing_mode)}</td><td>${b.active?'Active':'Disabled'}</td><td><form method="post" action="/admin/businesses/${b.id}/toggle"><button class="btn smallbtn">${b.active?'Disable':'Activate'}</button></form></td></tr>`).join('')}</tbody></table></div>`;
 res.send(layout('Businesses',`<main class="container"><a href="/admin">← Dashboard</a><h1>Businesses</h1>${form}${table}</main>`,true));
});
app.post('/admin/businesses',isAdmin,(req,res)=>{
 const name=String(req.body.name||'').trim(); if(!name)return res.redirect('/admin/businesses');
 let slug=slugify(name); if(!slug)slug='business';
 if(db.prepare('SELECT id FROM businesses WHERE slug=?').get(slug))slug += '-'+Date.now().toString().slice(-5);
 const result=db.prepare('INSERT INTO businesses(name,slug,description,pricing_mode) VALUES(?,?,?,?)').run(name,slug,String(req.body.description||''),String(req.body.pricing_mode||'FIXED'));
 audit(req,'CREATE','BUSINESS',result.lastInsertRowid);res.redirect('/admin/businesses');
});
app.post('/admin/businesses/:id/toggle',isAdmin,(req,res)=>{
 db.prepare('UPDATE businesses SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(req.params.id);audit(req,'TOGGLE','BUSINESS',req.params.id);res.redirect('/admin/businesses');
});

app.get('/admin/news',isAdmin,(req,res)=>{
 const businesses=db.prepare('SELECT id,name FROM businesses ORDER BY name').all();
 const rows=db.prepare('SELECT n.*,b.name AS business_name FROM news n LEFT JOIN businesses b ON b.id=n.business_id ORDER BY n.published_at DESC').all();
 const form=`<form class="card form" method="post" action="/admin/news"><h2>Publish News</h2><label>Title</label><input name="title" required><label>Description</label><textarea name="body" required></textarea><label>Scope</label><select name="scope" id="scope"><option value="GLOBAL">Global Devchuli News</option><option value="BUSINESS">Business News</option></select><label>Business (for business news)</label><select name="business_id"><option value="">Choose business</option>${businesses.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select><button class="btn primary">Publish News</button></form>`;
 const table=`<div class="grid">${rows.map(n=>`<div class="card"><span class="pill">${esc(n.scope)}</span><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p><p class="muted">${esc(n.business_name||'Devchuli Multiplex')} · ${esc(n.published_at)}</p><form method="post" action="/admin/news/${n.id}/toggle"><button class="btn smallbtn">${n.active?'Unpublish':'Publish'}</button></form></div>`).join('')}</div>`;
 res.send(layout('News Feed',`<main class="container"><a href="/admin">← Dashboard</a><h1>News Feed</h1>${form}<h2>Published / Draft News</h2>${table}</main>`,true));
});
app.post('/admin/news',isAdmin,(req,res)=>{
 const title=String(req.body.title||'').trim(),body=String(req.body.body||'').trim(),scope=req.body.scope==='BUSINESS'?'BUSINESS':'GLOBAL';
 if(!title||!body)return res.redirect('/admin/news');
 const businessId=scope==='BUSINESS'&&req.body.business_id?Number(req.body.business_id):null;
 const result=db.prepare('INSERT INTO news(title,body,scope,business_id) VALUES(?,?,?,?)').run(title,body,scope,businessId);
 audit(req,'CREATE','NEWS',result.lastInsertRowid);res.redirect('/admin/news');
});
app.post('/admin/news/:id/toggle',isAdmin,(req,res)=>{db.prepare('UPDATE news SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(req.params.id);audit(req,'TOGGLE','NEWS',req.params.id);res.redirect('/admin/news');});

app.get('/admin/pricing',isAdmin,(req,res)=>{
 const businesses=db.prepare('SELECT * FROM businesses ORDER BY name').all();
 const rows=db.prepare('SELECT p.*,b.name business_name FROM pricing p JOIN businesses b ON b.id=p.business_id ORDER BY b.name').all();
 res.send(layout('Pricing',`<main class="container"><a href="/admin">← Dashboard</a><h1>Pricing Management</h1><form class="card form" method="post" action="/admin/pricing"><h2>Add / Configure Pricing</h2><label>Business</label><select name="business_id" required>${businesses.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select><label>Label</label><input name="label" placeholder="Time interval / Day pass" required><label>Base price (Rs.)</label><input name="base_price" type="number" min="0" step="0.01" value="0" required><label>Interval minutes (time pricing only)</label><input name="increment_minutes" type="number" min="1" placeholder="20"><label>Price per interval (Rs.)</label><input name="price_per_increment" type="number" min="0" step="0.01" placeholder="50"><button class="btn primary">Save Pricing</button></form><div class="grid">${rows.map(p=>`<div class="card"><h3>${esc(p.business_name)}</h3><p>${esc(p.label)}</p>${p.increment_minutes?`<p>Every ${p.increment_minutes} min · ${money(p.price_per_increment)} per interval</p><p class="muted">${generateOptions(p.increment_minutes,p.price_per_increment,6).map(o=>`${o.label}: ${money(o.price)}`).join(' · ')}</p>`:`<b>${money(p.base_price)}</b>`}</div>`).join('')}</div></main>`,true));
});
app.post('/admin/pricing',isAdmin,(req,res)=>{
 const businessId=Number(req.body.business_id),label=String(req.body.label||'').trim(),base=Number(req.body.base_price||0);
 const interval=req.body.increment_minutes?Number(req.body.increment_minutes):null,price=req.body.price_per_increment!==''&&req.body.price_per_increment!=null?Number(req.body.price_per_increment):null;
 if(!businessId||!label||base<0||(interval!==null&&interval<=0)||(price!==null&&price<0))return res.status(400).send('Invalid pricing data');
 db.prepare('INSERT INTO pricing(business_id,label,base_price,increment_minutes,price_per_increment) VALUES(?,?,?,?,?)').run(businessId,label,base,interval,price);
 if(interval)db.prepare("UPDATE businesses SET pricing_mode='TIME_BASED' WHERE id=?").run(businessId);
 audit(req,'CREATE','PRICING',businessId);res.redirect('/admin/pricing');
});

app.get('/admin/services',isAdmin,(req,res)=>{
 const businesses=db.prepare('SELECT id,name FROM businesses ORDER BY name').all();
 const rows=db.prepare('SELECT s.*,b.name business_name FROM services s JOIN businesses b ON b.id=s.business_id ORDER BY s.id DESC').all();
 res.send(layout('Food & Services',`<main class="container"><a href="/admin">← Dashboard</a><h1>Food & Services</h1><form class="card form" method="post" action="/admin/services" enctype="multipart/form-data"><h2>Add Food / Service</h2><label>Business</label><select name="business_id">${businesses.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select><label>Name</label><input name="name" required><label>Category</label><input name="category"><label>Description</label><textarea name="description"></textarea><label>Photo (JPG/PNG/WebP/GIF, max 5MB)</label><input type="file" name="photo" accept="image/png,image/jpeg,image/webp,image/gif"><label>Price (Rs.)</label><input name="price" type="number" min="0" step="0.01" required><label><input type="checkbox" name="vat_included" checked> Price includes VAT</label><button class="btn primary">Add Item</button></form><div class="grid">${rows.map(s=>`<div class="card">${s.photo_url?`<img class="productimg" src="${esc(s.photo_url)}">`:''}<h3>${esc(s.name)}</h3><p>${esc(s.business_name)} · ${esc(s.category)}</p><b>${money(s.price)}</b><p class="muted">${s.vat_included?'VAT inclusive':'VAT exclusive'} · ${s.active?'Available':'Disabled'}</p><form method="post" action="/admin/services/${s.id}/toggle"><button class="btn smallbtn">${s.active?'Disable':'Enable'}</button></form></div>`).join('')}</div></main>`,true));
});
app.post('/admin/services',isAdmin,upload.single('photo'),(req,res)=>{
 const businessId=Number(req.body.business_id),name=String(req.body.name||'').trim(),price=Number(req.body.price);
 if(!businessId||!name||!Number.isFinite(price)||price<0)return res.status(400).send('Invalid service data');
 const photo=req.file?'/uploads/'+req.file.filename:'';
 const result=db.prepare('INSERT INTO services(business_id,name,category,description,photo_url,price,vat_included) VALUES(?,?,?,?,?,?,?)').run(businessId,name,String(req.body.category||''),String(req.body.description||''),photo,price,req.body.vat_included==='on'?1:0);
 audit(req,'CREATE','SERVICE',result.lastInsertRowid);res.redirect('/admin/services');
});
app.post('/admin/services/:id/toggle',isAdmin,(req,res)=>{db.prepare('UPDATE services SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(req.params.id);audit(req,'TOGGLE','SERVICE',req.params.id);res.redirect('/admin/services');});

app.get('/admin/settings',isAdmin,(req,res)=>{
 const ticket=setting('buy_ticket_url',DEFAULT_TICKET_URL),vat=setting('vat_rate',DEFAULT_VAT),name=setting('devchuli_name','Devchuli Multiplex');
 res.send(layout('Settings',`<main class="container"><a href="/admin">← Dashboard</a><h1>Settings & Branding</h1><form class="card form" method="post" action="/admin/settings"><label>App / Business Name</label><input name="devchuli_name" value="${esc(name)}" required><label>BUY TICKET URL</label><input name="buy_ticket_url" type="url" value="${esc(ticket)}" required><label>VAT percentage</label><input name="vat_rate" type="number" min="0" max="100" step="0.01" value="${esc(vat)}" required><button class="btn primary">Save Settings</button></form><div class="card"><h2>VAT calculation helper</h2><p>Current VAT: ${esc(vat)}%</p><p>For VAT-inclusive price Rs. 200: Net ${money(vatInclusive(200,Number(vat)).net)} · VAT ${money(vatInclusive(200,Number(vat)).vat)} · Total Rs. 200.00</p></div></main>`,true));
});
app.post('/admin/settings',isAdmin,(req,res)=>{
 const ticket=String(req.body.buy_ticket_url||'').trim(),vat=Number(req.body.vat_rate),name=String(req.body.devchuli_name||'').trim();
 try { const u=new URL(ticket); if(!['http:','https:'].includes(u.protocol))throw Error(); } catch { return res.status(400).send('Please enter a valid HTTP/HTTPS ticket URL.'); }
 if(!Number.isFinite(vat)||vat<0||vat>100||!name)return res.status(400).send('Invalid settings.');
 setSetting('buy_ticket_url',ticket);setSetting('vat_rate',vat);setSetting('devchuli_name',name);audit(req,'UPDATE','SETTINGS','global');res.redirect('/admin/settings');
});

app.get('/admin/branding',isAdmin,(req,res)=>res.send(layout('Branding',`<main class="container"><a href="/admin">← Dashboard</a><h1>Branding & Images</h1><div class="card"><p>Business cover images and food/service photos can currently be uploaded through their management forms. Global logo upload and gallery management are not implemented in this local version.</p></div></main>`,true)));
app.get('/admin/users',isAdmin,(req,res)=>{
 const rows=db.prepare('SELECT id,name,email,role,active,created_at FROM users ORDER BY id').all();
 res.send(layout('Users',`<main class="container"><a href="/admin">← Dashboard</a><h1>Users & Roles</h1><form class="card form" method="post" action="/admin/users"><h2>Create User</h2><label>Name</label><input name="name" required><label>Email</label><input name="email" type="email" required><label>Temporary password</label><input name="password" type="password" minlength="12" required><label>Role</label><select name="role"><option>STAFF</option><option>ADMIN</option><option>CUSTOMER</option><option>SUPER_ADMIN</option></select><button class="btn primary">Create User</button></form><div class="card tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${u.active?'Active':'Disabled'}</td><td>${u.email===ADMIN_EMAIL?'Primary admin':`<form method="post" action="/admin/users/${u.id}/toggle"><button class="btn smallbtn">${u.active?'Disable':'Enable'}</button></form>`}</td></tr>`).join('')}</tbody></table></div></main>`,true));
});
app.post('/admin/users',isAdmin,async(req,res)=>{
 const name=String(req.body.name||'').trim(),email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||''),role=String(req.body.role||'STAFF');
 if(!name||!email.includes('@')||password.length<12||!['SUPER_ADMIN','ADMIN','STAFF','CUSTOMER'].includes(role))return res.status(400).send('Invalid user data. Password must be at least 12 characters.');
 try{const hash=await bcrypt.hash(password,12);const result=db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(name,email,hash,role);audit(req,'CREATE','USER',result.lastInsertRowid);res.redirect('/admin/users');}catch(e){res.status(400).send('Could not create user. Email may already exist.');}
});
app.post('/admin/users/:id/toggle',isAdmin,(req,res)=>{
 if(Number(req.params.id)===req.session.user.id)return res.status(400).send('You cannot disable your own current account.');
 db.prepare('UPDATE users SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(req.params.id);audit(req,'TOGGLE','USER',req.params.id);res.redirect('/admin/users');
});
app.get('/admin/logs',isAdmin,(req,res)=>{
 const rows=db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all();
 res.send(layout('Audit Logs',`<main class="container"><a href="/admin">← Dashboard</a><h1>Audit Logs</h1><div class="card tablewrap"><table><thead><tr><th>Date</th><th>User</th><th>Action</th><th>Entity</th><th>ID</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.created_at)}</td><td>${esc(r.user_email)}</td><td>${esc(r.action)}</td><td>${esc(r.entity)}</td><td>${esc(r.entity_id)}</td></tr>`).join('')}</tbody></table></div></main>`,true));
});

app.get('/api/businesses',(req,res)=>res.json(db.prepare('SELECT id,name,slug,description,logo_url,cover_url,pricing_mode FROM businesses WHERE active=1 ORDER BY name').all()));
app.get('/api/news',(req,res)=>res.json(db.prepare("SELECT n.id,n.title,n.body,n.image_url,n.scope,n.published_at,b.name business_name FROM news n LEFT JOIN businesses b ON b.id=n.business_id WHERE n.active=1 ORDER BY n.published_at DESC LIMIT 100").all()));
app.get('/api/settings',(req,res)=>res.json({name:setting('devchuli_name','Devchuli Multiplex'),buyTicketUrl:setting('buy_ticket_url',DEFAULT_TICKET_URL),vatRate:Number(setting('vat_rate',DEFAULT_VAT))}));
app.get('/api/pricing/:slug',(req,res)=>{
 const b=db.prepare('SELECT id FROM businesses WHERE slug=? AND active=1').get(req.params.slug);if(!b)return res.status(404).json({error:'Business not found'});
 const p=db.prepare('SELECT * FROM pricing WHERE business_id=? AND active=1 ORDER BY id').all(b.id);
 res.json(p.map(x=>x.increment_minutes&&x.price_per_increment?{...x,options:generateOptions(x.increment_minutes,x.price_per_increment,10)}:x));
});
app.get('/api/health',(req,res)=>res.json({status:'ok'}));

app.use((err,req,res,next)=>{
 console.error(err.message);
 if(err instanceof multer.MulterError)return res.status(400).send('Upload error: file may be too large.');
 res.status(400).send('Request could not be processed.');
});
app.listen(PORT,()=>console.log(`Devchuli Multiplex running at http://localhost:${PORT}`));
