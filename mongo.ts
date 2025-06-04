import mongoose from 'mongoose';

(async () => {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/test', {
      user: 'test',
      pass: 'test',
      authSource: 'admin',
    });
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Connection error:', error);
  } finally {
    await mongoose.connection.close();
  }
})();
