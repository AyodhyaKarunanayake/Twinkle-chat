import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import io from 'socket.io-client';
import './Chat.css';

const Chat = () => {
  const { user, logout } = useAuth();
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io('http://localhost:5000', {
      auth: {
        token: localStorage.getItem('token')
      }
    });

    setSocket(newSocket);

    // Connection event handlers
    newSocket.on('connect', () => {
      setIsConnected(true);
      console.log('Connected to server');
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      console.log('Disconnected from server');
    });

    // Join user to socket
    newSocket.emit('join', {
      userId: user._id,
      username: user.username
    });

    // Message event handlers
    newSocket.on('message', (message) => {
      setMessages(prev => [...prev, message]);
    });

    newSocket.on('messageHistory', (history) => {
      setMessages(history);
    });

    // Online users handler
    newSocket.on('onlineUsers', (users) => {
      setOnlineUsers(users.filter(u => u.userId !== user._id));
    });

    // Typing event handlers
    newSocket.on('userTyping', ({ userId, username }) => {
      if (userId !== user._id) {
        setTypingUsers(prev => {
          const exists = prev.find(u => u.userId === userId);
          if (!exists) {
            return [...prev, { userId, username }];
          }
          return prev;
        });
      }
    });

    newSocket.on('userStoppedTyping', ({ userId }) => {
      setTypingUsers(prev => prev.filter(u => u.userId !== userId));
    });

    // Cleanup on unmount
    return () => {
      newSocket.close();
    };
  }, [user]);

  // When onlineUsers change, auto-select the first available user (not self)
  useEffect(() => {
    if (onlineUsers.length > 0) {
      setSelectedUser(onlineUsers[0]);
    } else {
      setSelectedUser(null);
    }
  }, [onlineUsers]);

  // Store chat history per user
  const [userChats, setUserChats] = useState({});

  // When a message is received, update the correct chat
  useEffect(() => {
    if (!messages.length) return;
    setUserChats(prev => {
      const lastMsg = messages[messages.length - 1];
      const otherUserId = String(lastMsg.sender?._id || lastMsg.sender) === String(user._id)
        ? String(lastMsg.recipient?._id || lastMsg.recipient)
        : String(lastMsg.sender?._id || lastMsg.sender);
      const chatKey = otherUserId;
      const prevMsgs = prev[chatKey] || [];
      // Avoid duplicate messages
      if (prevMsgs.some(m => m._id === lastMsg._id)) return prev;
      return {
        ...prev,
        [chatKey]: [...prevMsgs, lastMsg]
      };
    });
  }, [messages, user._id]);

  // When switching users, load their chat history
  useEffect(() => {
    if (!selectedUser) return;
    const chatKey = selectedUser.userId;
    // Filter all messages for this user
    const filtered = messages.filter(msg =>
      (String(msg.sender?._id || msg.sender) === String(user._id) && String(msg.recipient?._id || msg.recipient) === String(chatKey)) ||
      (String(msg.sender?._id || msg.sender) === String(chatKey) && String(msg.recipient?._id || msg.recipient) === String(user._id))
    );
    setUserChats(prev => ({ ...prev, [chatKey]: filtered }));
  }, [selectedUser, messages, user._id]);

  // Handle sending messages
  const handleSendMessage = (e) => {
    e.preventDefault();
    
    if (!newMessage.trim() || !socket || !selectedUser) return;

    const messageData = {
      text: newMessage.trim(),
      sender: user._id,
      senderName: user.username,
      recipient: selectedUser.userId, // <-- add recipient
      timestamp: new Date()
    };

    socket.emit('sendMessage', messageData);
    setNewMessage('');
    
    // Stop typing
    if (isTyping) {
      socket.emit('stopTyping');
      setIsTyping(false);
    }
  };

  // Handle typing events
  const handleTyping = (e) => {
    setNewMessage(e.target.value);

    if (!socket) return;

    if (!isTyping) {
      setIsTyping(true);
      socket.emit('typing', {
        userId: user._id,
        username: user.username
      });
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout to stop typing
    typingTimeoutRef.current = setTimeout(() => {
      if (isTyping && socket) {
        socket.emit('stopTyping');
        setIsTyping(false);
      }
    }, 2000);
  };

  // Format timestamp
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Format date separator
  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString();
    }
  };

  // Group messages by date
  const groupMessagesByDate = (messages) => {
    const groups = [];
    let currentDate = null;

    messages.forEach((message, index) => {
      const messageDate = new Date(message.timestamp).toDateString();
      
      if (messageDate !== currentDate) {
        groups.push({
          type: 'date',
          date: messageDate,
          timestamp: message.timestamp
        });
        currentDate = messageDate;
      }
      
      groups.push({
        type: 'message',
        ...message,
        index
      });
    });

    return groups;
  };

  const groupedMessages = groupMessagesByDate(messages);

  return (
    <div className="chat-container">
      {/* Chat Header */}
      <div className="chat-header">
        <div className="header-left">
          <h1>Twinkle</h1>
          <div className="connection-status">
            <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}></span>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
        <div className="header-right">
          <span className="welcome-text">Welcome, {user.username}!</span>
          <button onClick={logout} className="logout-btn">
            Logout
          </button>
        </div>
      </div>

      <div className="chat-body" style={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
        {/* Sidebar with online users */}
        <div className="sidebar" style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 220, flexShrink: 0, overflow: 'hidden' }}>
          <div className="online-users" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <h3 style={{ flexShrink: 0 }}>Online Users ({onlineUsers.length})</h3>
            <div
              className="user-list"
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                paddingRight: 4,
                minHeight: 0
              }}
            >
              {onlineUsers.map((onlineUser) => (
                <div
                  key={onlineUser.userId}
                  className={`user-item${selectedUser && selectedUser.userId === onlineUser.userId ? ' selected' : ''}`}
                  onClick={() => setSelectedUser(onlineUser)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="user-avatar">👤</span>
                  <span className="username">{onlineUser.username}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main chat area */}
        <div className="chat-main" style={{ flex: 1, height: '100%', overflowY: 'auto', minWidth: 0 }}>
          {/* Only show chat if a user is selected */}
          {selectedUser ? (
            <div className="messages-container">
              {/* Show only the chat for the selected user */}
              {(() => {
                const chatKey = selectedUser.userId;
                const filteredMessages = userChats[chatKey] || [];
                if (filteredMessages.length === 0) {
                  return (
                    <div className="no-messages">
                      <p>No messages yet. Start the conversation! 👋</p>
                    </div>
                  );
                }
                // Group filtered messages by date
                let lastDate = null;
                return filteredMessages.map((item, idx) => {
                  const msgDate = new Date(item.timestamp).toDateString();
                  let dateSeparator = null;
                  if (msgDate !== lastDate) {
                    dateSeparator = (
                      <div key={`date-${msgDate}`} className="date-separator">
                        <span>{formatDate(item.timestamp)}</span>
                      </div>
                    );
                    lastDate = msgDate;
                  }
                  const isOwn = String(item.sender?._id || item.sender) === String(user._id);
                  return (
                    <React.Fragment key={item._id || idx}>
                      {dateSeparator}
                      <div
                        className={`message ${isOwn ? 'own-message' : 'other-message'}`}
                        style={{
                          display: 'flex',
                          flexDirection: isOwn ? 'row-reverse' : 'row',
                          alignItems: 'flex-end',
                          justifyContent: isOwn ? 'flex-end' : 'flex-start',
                          marginBottom: 8,
                          width: '100%', // Make message row take full width
                        }}
                        aria-label={isOwn ? 'Sent message' : 'Received message'}
                      >
                        {/* Avatar */}
                        <div
                          className="message-avatar"
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            background: isOwn ? '#43b581' : '#e0e0e0',
                            color: isOwn ? '#fff' : '#333',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            fontSize: 18,
                            margin: isOwn ? '0 0 0 8px' : '0 8px 0 0',
                            flexShrink: 0
                          }}
                        >
                          {isOwn ? user.username[0].toUpperCase() : (item.senderName ? item.senderName[0].toUpperCase() : '?')}
                        </div>
                        <div
                          className="message-bubble"
                          style={{
                            background: isOwn ? '#43b581' : '#fff',
                            color: isOwn ? '#fff' : '#333',
                            borderRadius: isOwn ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                            padding: '10px 16px',
                            maxWidth: '70%',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
                            marginLeft: isOwn ? 0 : 4,
                            marginRight: isOwn ? 4 : 0,
                            textAlign: 'left',
                            position: 'relative'
                          }}
                        >
                          {!isOwn && (
                            <div className="message-sender" style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, color: '#43b581' }}>{item.senderName}</div>
                          )}
                          <span className="message-text">{item.text}</span>
                          <span className="message-time" style={{ display: 'block', fontSize: 11, color: isOwn ? '#eafff3' : '#888', marginTop: 4, textAlign: isOwn ? 'right' : 'left' }}>{formatTime(item.timestamp)}</span>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                });
              })()}
              {/* Typing indicator */}
              {typingUsers.length > 0 && (
                <div className="typing-indicator">
                  <div className="typing-animation">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <span className="typing-text">
                    {typingUsers.length === 1 
                      ? `${typingUsers[0].username} is typing...`
                      : `${typingUsers.length} people are typing...`
                    }
                  </span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          ) : (
            <div className="no-messages">
              <p>Select a user to start chatting.</p>
            </div>
          )}

          {/* Message input only if a user is selected */}
          {selectedUser && (
            <form onSubmit={handleSendMessage} className="message-input-container">
              <div className="input-wrapper">
                <input
                  type="text"
                  value={newMessage}
                  onChange={handleTyping}
                  placeholder={`Message ${selectedUser.username}...`}
                  className="message-input"
                  disabled={!isConnected}
                />
                <button 
                  type="submit" 
                  className="send-button"
                  disabled={!newMessage.trim() || !isConnected}
                >
                  <span>📤</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Chat;