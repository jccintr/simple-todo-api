import Todo from '../../models/todo.js';
import { createUser } from './user.factory.js';
import { createCategory } from './category.factory.js';

/**
 * Cria um Todo no banco.
 * Se não passar `user`, cria um User.
 * Se não passar `category`, cria uma Category para esse user.
 * @param {object} overrides
 * @returns {Promise<import('mongoose').Document>}
 */
export async function createTodo(overrides = {}) {
  let userId = overrides.user;

  if (!userId) {
    const user = await createUser();
    userId = user._id;
  }

  let categoryId = overrides.category;
  if (!categoryId) {
    const category = await createCategory({ user: userId });
    categoryId = category._id;
  }

  const todo = await Todo.create({
    user: userId,
    category: categoryId,
    description: 'Comprar pão',
    done: false,
    priority: 'medium',
    ...overrides,
    user: userId,
    category: categoryId,
  });

  return todo;
}