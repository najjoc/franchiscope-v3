// ──────────────────────────────────────────────────────────────
// server.js  –  FULL VERSION (bright-theme + NPS + bug fixes)
// last edited: 2025-06-25   • namespace regex bug FIXED
// ──────────────────────────────────────────────────────────────
const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const mongoose   = require('mongoose');
const multer     = require('multer');
const path       = require('path');
const http       = require('http');
const socketIo   = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = socketIo(server);

// ───────────────── View & middleware ──────────────────────────
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'secretKey', resave: false, saveUninitialized: true }));
app.use(express.static('public'));

// email gate
app.use((req, res, next) => {
  const allowed = ['/', '/submit-email', '/uploads', '/public', '/admin'];
  if (!req.session.emailEntered && !allowed.some(p => req.path.startsWith(p))) {
    return res.send("⚠️ You must enter your email to proceed. <a href='/'>Go back</a>");
  }
  next();
});

// ───────────────── Multer (contractFile) ──────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, 'uploads/'),
  filename   : (_, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ───────────────── MongoDB models ─────────────────────────────
mongoose
  .connect('mongodb+srv://NajjoC:Najjar123@cluster0.ksdjyap.mongodb.net/franchiscope?retryWrites=true&w=majority&appName=Cluster0')
  .then(() => {
    console.log('✅ MongoDB connected');
    server.listen(3000, () => console.log('🚀 http://localhost:3000'));
  })
  .catch(err => console.error('❌ Mongo error:', err));

const User = mongoose.model('User', new mongoose.Schema({
  role: String,
  franchiseName: String,
  info: String,
  rating: Number,
  contractFileName: String
}));

const Message = mongoose.model('Message', new mongoose.Schema({
  room: String,
  sender: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
}));

const FeedbackResponse = mongoose.model('FeedbackResponse', new mongoose.Schema({
  feedbackId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  response: String,
  responder: String,
  timestamp: { type: Date, default: Date.now }
}));

const SectionVisitCounter = mongoose.model('SectionVisitCounter', new mongoose.Schema({
  role: { type: String, unique: true },
  count: { type: Number, default: 0 }
}));

const EmailUser = mongoose.model('EmailUser', new mongoose.Schema({
  email: String,
  timestamp: { type: Date, default: Date.now }
}));

// ───────────────── Routes ─────────────────────────────────────
// email gate
app.get('/', (req, res) => res.render('email'));

app.post('/submit-email', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.send('❌ Please enter a valid email.');
  await new EmailUser({ email }).save();
  req.session.emailEntered = true;
  res.redirect('/home');
});

app.post('/delete-email/:id', async (req, res) => {
  if (!req.session.isAdmin) return res.send('❌ Unauthorized');
  await EmailUser.findByIdAndDelete(req.params.id);
  res.redirect('/admin');
});

// home / role
app.get('/home', (req, res) =>
  res.render('index', { role: null, franchises: [], feedbacks: [], message: null, selectedFranchise: null })
);

app.post('/home', async (req, res) => {
  const role = req.body.role;
  req.session.role = role;
  let franchises = [];
  if (role === 'future-franchisee' || role === 'franchisor') {
    franchises = await User.distinct('franchiseName', { role: 'franchisee' });
    await SectionVisitCounter.findOneAndUpdate({ role }, { $inc: { count: 1 } }, { upsert: true });
  }
  res.render('index', { role, franchises, feedbacks: [], message: null, selectedFranchise: null });
});

// franchise list
app.get('/franchise-list', async (req, res) => {
  const franchises = await User.distinct('franchiseName', { role: 'franchisee' });
  res.render('franchiselist', { franchises });
});

// submit feedback (NPS 0-10)
app.post('/submit-feedback', upload.single('contractFile'), async (req, res) => {
  const { franchiseName, info, rating } = req.body;
  await new User({
    role: 'franchisee',
    franchiseName,
    info,
    rating: Number(rating),
    contractFileName: req.file ? req.file.filename : ''
  }).save();
  await SectionVisitCounter.findOneAndUpdate({ role: 'franchisee' }, { $inc: { count: 1 } }, { upsert: true });
  res.send('✅ Feedback submitted! <a href="/home">Back to Home</a>');
});

// view feedback
app.get('/feedback/:franchiseName', async (req, res) => {
  const { franchiseName } = req.params;
  const feedbacks  = await User.find({ franchiseName, role: 'franchisee' });
  const responses  = await FeedbackResponse.find({ feedbackId: { $in: feedbacks.map(f => f._id) } });
  res.render('feedback', { franchiseName, feedbacks, responses, userRole: req.session.role });
});

// franchisor view feedback list
app.post('/franchisor-feedback', async (req, res) => {
  const selectedFranchise = req.body.selectedFranchise;
  const feedbacks  = await User.find({ franchiseName: selectedFranchise, role: 'franchisee' });
  const franchises = await User.distinct('franchiseName', { role: 'franchisee' });
  res.render('index', {
    role: 'franchisor',
    franchises,
    feedbacks,
    selectedFranchise,
    message: feedbacks.length ? null : 'No feedback yet'
  });
});

// franchisor responses page
app.post('/franchisor-responses', async (req, res) => {
  const franchiseName = req.body.franchiseName;
  const feedbacks = await User.find({ franchiseName, role: 'franchisee' });
  const responses = await FeedbackResponse.find({ feedbackId: { $in: feedbacks.map(f => f._id) } }).populate('feedbackId');
  res.render('franchisorResponses', { franchiseName, feedbacks, responses });
});

// franchisor submits response
app.post('/respond-feedback/:id', async (req, res) => {
  const { response, responder } = req.body;
  await new FeedbackResponse({ feedbackId: req.params.id, response, responder }).save();
  await SectionVisitCounter.findOneAndUpdate({ role: 'franchisor' }, { $inc: { count: 1 } }, { upsert: true });
  res.redirect('/home');
});

// franchisee sees franchisor responses
app.get('/my-responses', async (req, res) => {
  const { franchiseName } = req.query;
  const franchises = await User.distinct('franchiseName', { role: 'franchisee' });
  let responses = [], message = null;
  if (franchiseName) {
    const fb = await User.find({ franchiseName, role: 'franchisee' });
    responses = await FeedbackResponse.find({ feedbackId: { $in: fb.map(f => f._id) } }).populate('feedbackId');
    if (!responses.length) message = 'No response from franchisor yet.';
  }
  res.render('myResponses', { franchises, selectedFranchise: franchiseName || '', responses, message, role: req.session.role });
});

// chat routes
app.get('/my-chats', async (req, res) => {
  const feedbacks = await User.find({ role: 'franchisee' });
  res.render('myChats', { feedbacks, role: req.session.role });
});

app.get('/start-chat/:id', async (req, res) => {
  const fb   = await User.findById(req.params.id);
  const msgs = await Message.find({ room: req.params.id }).sort('timestamp');
  res.render('chat', { franchiseeId: fb._id, franchiseeName: fb.franchiseName, messages: msgs });
});

// admin login + dashboard (unchanged logic)
app.get('/admin', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.render('admin', { isAdmin: false, users: [], messages: [], sectionCounts: {}, responses: [], emailUsers: [] });
  }

  const [users, messages, responses, counters, emailUsers] = await Promise.all([
    User.find(),
    Message.find().sort('-timestamp'),
    FeedbackResponse.find().populate('feedbackId'),
    SectionVisitCounter.find(),
    EmailUser.find().sort('-timestamp')
  ]);
  const sectionCounts = {};
  counters.forEach(c => (sectionCounts[c.role] = c.count));
  res.render('admin', { isAdmin: true, users, messages, sectionCounts, responses, emailUsers });
});

app.post('/admin', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin123') {
    req.session.isAdmin = true;
    res.redirect('/admin');
  } else {
    res.send('❌ Invalid admin credentials. <a href="/admin">Try again</a>');
  }
});

// delete routes
app.post('/delete/:id',          async (req,res)=>{ if(!req.session.isAdmin) return res.send('❌'); await User.findByIdAndDelete(req.params.id);      res.redirect('/admin'); });
app.post('/delete-message/:id',  async (req,res)=>{ if(!req.session.isAdmin) return res.send('❌'); await Message.findByIdAndDelete(req.params.id);    res.redirect('/admin'); });
app.post('/delete-response/:id', async (req,res)=>{ if(!req.session.isAdmin) return res.send('❌'); await FeedbackResponse.findByIdAndDelete(req.params.id); res.redirect('/admin'); });

// ───────────────── Socket.io (namespaced rooms) ───────────────
io.of(/^\/\w+$/).on('connection', socket => {
  const room = socket.nsp.name.slice(1);            // e.g., namespace "/64f3ab..."
  socket.on('chat message', async data => {
    await new Message({ room, sender: data.sender, text: data.text }).save();
    io.of(`/${room}`).emit('chat message', data);    // ← fixed: normal template
  });
});
