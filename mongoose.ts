/**
 * Copyright (c) 2025 Mike Odnis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import mongoose from "mongoose";

(async () => {
	const testSchema = new mongoose.Schema({
		name: String,
		age: Number,
	});
	const test = mongoose.model("Test", testSchema);

	try {
		await mongoose.connect("mongodb://127.0.0.1:27017/test", {
			user: "test",
			pass: "test",
			authSource: "admin",
		});
		console.log("Connected to MongoDB");
		const db = mongoose.connection.db;

		if (db) {
			const collections = await db
				.listCollections()
				.toArray()
				.then((collections) =>
					collections.map((collection) => collection.name),
				);
			console.log(collections);
		}
		const collection = db?.collection("test");
		if (collection) {
			const documents = await collection
				.find({})
				.toArray()
				.then((documents) => documents.map((document) => document.name));
			console.log(documents);
		}
	} catch (error) {
		console.error("Connection error:", error);
	} finally {
		await mongoose.connection.close();
	}
})();
