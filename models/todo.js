import mongoose from 'mongoose';

// Todo.js
const todoSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
  description: { type: String, required: true, trim: true },
  done: { type: Boolean, default: false, index: true },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
}, { timestamps: true });

todoSchema.index({ user: 1, done: 1, createdAt: -1 });
todoSchema.index({ user: 1, category: 1 });

const Todo = mongoose.model('Todo', todoSchema);

export default Todo;