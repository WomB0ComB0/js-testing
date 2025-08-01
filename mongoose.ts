/**
 * Copyright 2025 Mike Odnis
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import mongoose from 'mongoose';

(async () => {
  const testSchema = new mongoose.Schema({
    name: String,
    age: Number
  });
  const test = mongoose.model('Test', testSchema);

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
