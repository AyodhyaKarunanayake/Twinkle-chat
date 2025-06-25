require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Import models
const User = require('./models/User');
const Message = require('./models/Message');

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatapp')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB error:', err));

const app = express();
const server = http.createServer(app);

// Middlewares
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// Auth routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Configure Socket.IO with CORS
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware for Socket.IO authentication
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // Get user from database
    const user = await User.findById(decoded.userId);
    if (!user) {
      return next(new Error('User not found'));
    }
    
    socket.userId = decoded.userId;
    socket.username = decoded.username;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

// Store connected users
const connectedUsers = new Map();

// Socket.IO connection handling
io.on('connection', async (socket) => {
  console.log(`User ${socket.username} connected`);

  // Handle user joining
  socket.on('join', async ({ userId, username }) => {
    connectedUsers.set(socket.id, { userId, username, socketId: socket.id });
    
    // Update user online status
    await User.findByIdAndUpdate(userId, { isOnline: true });
    
    // Send message history to the new user
    try {
      const messages = await Message.find({})
        .sort({ createdAt: 1 })
        .limit(50); // Limit to last 50 messages
      
      // Format messages for client
      const formattedMessages = messages.map(msg => ({
        _id: msg._id,
        text: msg.text,
        sender: msg.sender.toString(),
        senderName: msg.senderName,
        timestamp: msg.createdAt
      }));
      
      console.log(`Sending ${formattedMessages.length} messages to ${username}`);
      socket.emit('messageHistory', formattedMessages);
    } catch (error) {
      console.error('Error fetching message history:', error);
      socket.emit('messageHistory', []);
    }
    
    // Broadcast updated online users list
    const onlineUsers = Array.from(connectedUsers.values());
    io.emit('onlineUsers', onlineUsers);
  });

  // Handle sending messages
  socket.on('sendMessage', async (messageData) => {
    try {
      console.log('Received message data:', messageData);
      
      // Create message in database (include recipient)
      const message = new Message({
        text: messageData.text,
        sender: messageData.sender,
        senderName: messageData.senderName,
        recipient: messageData.recipient,
        recipientName: messageData.recipientName
      });
      
      await message.save();
      console.log('Message saved to database:', message);
      
      // Create the message object to broadcast (include recipient)
      const broadcastMessage = {
        _id: message._id,
        text: message.text,
        sender: message.sender.toString(),
        senderName: message.senderName,
        recipient: message.recipient.toString(),
        recipientName: message.recipientName,
        timestamp: message.createdAt
      };
      
      console.log('Broadcasting message:', broadcastMessage);
      
      // Find sockets for sender and recipient
      const senderSocket = Array.from(connectedUsers.values()).find(u => u.userId === message.sender.toString());
      const recipientSocket = Array.from(connectedUsers.values()).find(u => u.userId === message.recipient.toString());
      
      // Emit to sender
      if (senderSocket) {
        io.to(senderSocket.socketId).emit('message', broadcastMessage);
      }
      // Emit to recipient (if online and not the sender)
      if (recipientSocket && recipientSocket.socketId !== senderSocket.socketId) {
        io.to(recipientSocket.socketId).emit('message', broadcastMessage);
      }
    } catch (error) {
      console.error('Error saving message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle typing events
  socket.on('typing', (data) => {
    socket.broadcast.emit('userTyping', data);
  });

  socket.on('stopTyping', () => {
    socket.broadcast.emit('userStoppedTyping', { userId: socket.userId });
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`User ${socket.username} disconnected`);
    
    // Update user offline status
    try {
      await User.findByIdAndUpdate(socket.userId, { 
        isOnline: false,
        lastSeen: new Date()
      });
    } catch (error) {
      console.error('Error updating user offline status:', error);
    }
    
    connectedUsers.delete(socket.id);
    
    // Broadcast updated online users list
    const onlineUsers = Array.from(connectedUsers.values());
    io.emit('onlineUsers', onlineUsers);
  });
});

// Basic route for testing
app.get('/', (req, res) => {
  res.json({ message: 'Chat Server is running!' });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await User.updateMany({ isOnline: true }, { isOnline: false, lastSeen: new Date() });
  process.exit(0);
});