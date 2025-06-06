import mongoose from 'mongoose';

(async () => {
  const testSchema = new mongoose.Schema({
    name: String,
    age: Number
  });
  const Test = mongoose.model('Test', testSchema);

  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/test', {
      user: 'test',
      pass: 'test',
      authSource: 'admin'
    });
    console.log('Connected to MongoDB');
    const db = mongoose.connection.db;

    if (db) {
      const collections = await db.listCollections().toArray().then(collections => collections.map(collection => collection.name));
      console.log(collections);
    }
    const collection = db?.collection('test');
    if (collection) {
      const documents = await collection.find({}).toArray().then(documents => documents.map(document => document.name));
      console.log(documents);
    }
  } catch (error) {
    console.error('Connection error:', error);
  } finally {
    await mongoose.connection.close();
  }
})();
