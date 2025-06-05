const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from the repository root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Basic Authentication Middleware
 * Implements HTTP Basic Authentication for routes
 */
const basicAuth = (req, res, next) => {
  // Get credentials from request header
  const authHeader = req.headers.authorization;
  
  // Check if auth header exists
  if (!authHeader) {
    res.set('WWW-Authenticate', 'Basic realm="Access to BetterOMI"');
    return res.status(401).send('Authentication required');
  }
  
  // Check if it's a valid basic auth header
  if (!authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Access to BetterOMI"');
    return res.status(401).send('Invalid authentication');
  }
  
  // Get credentials from header
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');
  
  // Get credentials from environment variables
  const validUsername = process.env.BASIC_AUTH_USERNAME;
  const validPassword = process.env.BASIC_AUTH_PASSWORD;
  
  // Check if environment variables are set
  if (!validUsername || !validPassword) {
    console.error('Basic authentication credentials not set in environment variables');
    return res.status(500).send('Authentication not configured');
  }
  
  // Validate credentials
  if (username === validUsername && password === validPassword) {
    return next(); // Authentication successful
  }
  
  // Authentication failed
  res.set('WWW-Authenticate', 'Basic realm="Access to BetterOMI"');
  return res.status(401).send('Invalid credentials');
};

module.exports = basicAuth; 
