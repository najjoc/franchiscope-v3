const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'secretKey', resave: false, saveUninitialized: true }));
app.use(express.static('public'));

// Middleware: Require email before access
app.use((req, res, next) => {
  const allowedPaths = ['/', '/submit-email', '/uploads', '/public', '/admin'];
  if (!req.session.emailEntered && !allowedPaths.some(p => req.path.startsWith(p))) {
    return res.send("⚠️ You must enter your email to proceed. <a href='/'>Go back</a>");
  }
  next();
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

mongoose.connect('mongodb+srv://NajjoC:Najjar123@cluster0.ksdjyap.mongodb.net/franchiscope?retryWrites=true&w=majority&appName=Cluster0')
  .then(() => {
    console.log("✅ Connected to MongoDB!");
    server.listen(3000, () => console.log('🚀 Server running at http://localhost:3000'));
  })
  .catch((err) => console.error("❌ MongoDB connection error:", err));

const userSchema = new mongoose.Schema({
  role: String,
  franchiseName: String,
  info: String,
  rating: Number,
  contractFileName: String
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  room: String,
  sender: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const feedbackResponseSchema = new mongoose.Schema({
  feedbackId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  response: String,
  responder: String,
  timestamp: { type: Date, default: Date.now }
});
const FeedbackResponse = mongoose.model('FeedbackResponse', feedbackResponseSchema);

const sectionVisitCounterSchema = new mongoose.Schema({
  role: { type: String, unique: true },
  count: { type: Number, default: 0 }
});
const SectionVisitCounter = mongoose.model('SectionVisitCounter', sectionVisitCounterSchema);

const emailUserSchema = new mongoose.Schema({
  email: String,
  timestamp: { type: Date, default: Date.now }
});
const EmailUser = mongoose.model('EmailUser', emailUserSchema);

// Email entry
app.get('/', (req, res) => {
  res.render('email');
});

app.post('/submit-email', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.send("❌ Please enter a valid email.");
  }
  const newEmail = new EmailUser({ email });
  await newEmail.save();
  req.session.emailEntered = true;
  res.redirect('/home');
});

app.post('/delete-email/:id', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.send('❌ Unauthorized access.');
  }
  try {
    await EmailUser.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
  } catch (err) {
    console.error("Error deleting email:", err);
    res.send('Error deleting email.');
  }
});

// Real home page
app.get('/home', async (req, res) => {
  res.render('index', { role: null, franchises: [], feedbacks: [], message: null, selectedFranchise: null, pseudoName: null });
});

app.post('/home', async (req, res) => {
  const { role } = req.body;
  req.session.role = role;
  if (role === 'future-franchisee') {
    await SectionVisitCounter.findOneAndUpdate(
      { role: role },
      { $inc: { count: 1 } },
      { upsert: true, new: true }
    );
    const franchises = await User.distinct('franchiseName', { role: 'franchisee' });
    res.render('index', { role, franchises, feedbacks: [], message: null, selectedFranchise: null, pseudoName: null });
  } else if (role === 'franchisor') {
    const franchises = await User.distinct('franchiseName', { role: 'franchisee' });
    res.render('index', { role, franchises, feedbacks: [], message: null, selectedFranchise: null, pseudoName: null });
  } else {
    res.render('index', { role, franchises: [], feedbacks: [], message: null, selectedFranchise: null, pseudoName: null });
  }
});

app.post('/franchisor-feedback', async (req, res) => {
  const selectedFranchise = req.body.selectedFranchise;
  const userRole = req.session.role;
  try {
    const feedbacks = await User.find({ franchiseName: selectedFranchise, role: 'franchisee' });
    const franchises = await User.distinct('franchiseName', { role: 'franchisee' });
    res.render('index', {
      role: userRole,
      franchises,
      selectedFranchise,
      feedbacks,
      message: feedbacks.length === 0 ? 'No feedback available for this franchise yet.' : null,
      pseudoName: null
    });
  } catch (error) {
    console.error('Error loading feedbacks for franchisor:', error);
    res.send('Error loading feedbacks.');
  }
});

app.post('/submit-feedback', upload.single('contractFile'), async (req, res) => {
  const { franchiseName, info, rating } = req.body;
  let contractFileName = '';
  if (req.file) {
    contractFileName = req.file.filename;
  }

  const user = new User({
    role: 'franchisee',
    franchiseName,
    info,
    rating: parseInt(rating),
    contractFileName
  });

  await user.save();

  await SectionVisitCounter.findOneAndUpdate(
    { role: 'franchisee' },
    { $inc: { count: 1 } },
    { upsert: true, new: true }
  );

  res.send('✅ Feedback submitted! <a href="/home">Back to Home</a>');
});

app.post('/respond-feedback/:id', async (req, res) => {
  const feedbackId = req.params.id;
  const { response, responder } = req.body;
  try {
    const feedbackResponse = new FeedbackResponse({
      feedbackId,
      response,
      responder
    });
    await feedbackResponse.save();

    await SectionVisitCounter.findOneAndUpdate(
      { role: 'franchisor' },
      { $inc: { count: 1 } },
      { upsert: true, new: true }
    );

    res.redirect('/home');
  } catch (error) {
    console.error('Error saving response:', error);
    res.send('Error submitting response.');
  }
});

app.get('/my-responses', async (req, res) => {
  const { franchiseName } = req.query;
  const userRole = req.session.role;
  try {
    const franchises = await User.distinct('franchiseName', { role: 'franchisee' });
    let responses = [];
    let message = null;
    if (franchiseName) {
      const feedbacks = await User.find({ role: 'franchisee', franchiseName });
      responses = await FeedbackResponse.find({ feedbackId: { $in: feedbacks.map(f => f._id) } }).populate('feedbackId');
      if (responses.length === 0) {
        message = "No response from franchisor yet for this franchise.";
      }
    }
    res.render('myResponses', { franchises, selectedFranchise: franchiseName || '', responses, message, role: userRole });
  } catch (error) {
    console.error('Error loading responses:', error);
    res.send('Error loading responses.');
  }
});

app.get('/feedback/:franchiseName', async (req, res) => {
  const franchiseName = req.params.franchiseName;
  const userRole = req.session.role;
  try {
    const feedbacks = await User.find({ franchiseName: franchiseName, role: 'franchisee' });
    const responses = await FeedbackResponse.find({ feedbackId: { $in: feedbacks.map(f => f._id) } });
    res.render('feedback', { franchiseName, feedbacks, responses, userRole });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.send('Error fetching feedback.');
  }
});

app.get('/start-chat/:id', async (req, res) => {
  const feedbackId = req.params.id;
  try {
    const feedback = await User.findById(feedbackId);
    if (!feedback) {
      return res.send('Feedback not found.');
    }
    const messages = await Message.find({ room: feedbackId }).sort('timestamp');
    res.render('chat', {
      franchiseeId: feedbackId,
      franchiseeName: feedback.franchiseName,
      messages: messages
    });
  } catch (error) {
    console.error(error);
    res.send('Error starting chat.');
  }
});

app.get('/my-chats', async (req, res) => {
  const userRole = req.session.role;
  try {
    const feedbacks = await User.find({ role: 'franchisee' });
    res.render('myChats', { feedbacks, role: userRole });
  } catch (error) {
    console.error(error);
    res.send('Error loading your chats.');
  }
});

io.of(/^\/\w+$/).on('connection', (socket) => {
  const room = socket.nsp.name.slice(1);
  console.log(`User connected to room ${room}`);
  socket.on('chat message', async (data) => {
    const message = new Message({ room: room, sender: data.sender, text: data.text });
    await message.save();
    io.of(`/${room}`).emit('chat message', { text: data.text, sender: data.sender });
  });
  socket.on('disconnect', () => {
    console.log(`User disconnected from room ${room}`);
  });
});

app.get('/admin', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.render('admin', { isAdmin: false, users: [], messages: [], sectionCounts: {}, responses: [], emailUsers: [] });
  }
  try {
    const users = await User.find();
    const messages = await Message.find().sort('-timestamp');
    const responses = await FeedbackResponse.find().populate('feedbackId');
    const counters = await SectionVisitCounter.find();
    const emailUsers = await EmailUser.find().sort('-timestamp');
    const sectionCounts = {};
    counters.forEach((c) => {
      sectionCounts[c.role] = c.count;
    });
    res.render('admin', { isAdmin: true, users, messages, sectionCounts, responses, emailUsers });
  } catch (error) {
    console.error('Error fetching admin data:', error);
    res.send('Error fetching admin data.');
  }
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

app.post('/delete/:id', async (req, res) => {
  if (!req.session.isAdmin) return res.send('❌ Unauthorized access.');
  try {
    await User.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
  } catch (error) {
    console.error('Error deleting feedback:', error);
    res.send('Error deleting feedback.');
  }
});

app.post('/delete-message/:id', async (req, res) => {
  if (!req.session.isAdmin) return res.send('❌ Unauthorized access.');
  try {
    await Message.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
  } catch (error) {
    console.error('Error deleting message:', error);
    res.send('Error deleting message.');
  }
});

app.post('/delete-response/:id', async (req, res) => {
  if (!req.session.isAdmin) return res.send('❌ Unauthorized access.');
  try {
    await FeedbackResponse.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
  } catch (error) {
    console.error('Error deleting franchisor response:', error);
    res.send('Error deleting franchisor response.');
  }
});
