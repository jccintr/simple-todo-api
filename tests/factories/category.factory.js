import Category from '../../models/category.js';
import { createUser } from './user.factory.js';

/**
 * Cria uma Category no banco.
 * Se não passar `user`, cria um User automaticamente.
 * @param {object} overrides - campos para sobrescrever os defaults
 * @returns {Promise<import('mongoose').Document>}
 */
export async function createCategory(overrides = {}) {
  let userId = overrides.user;

  if (!userId) {
    const user = await createUser();
    userId = user._id;
  }

  const category = await Category.create({
    user: userId,
    name: 'Pessoal',
    ...overrides,
    user: userId,
  });

  return category;
}

/**
 * Cria as 3 categorias padrão para um usuário.
 * @param {import('mongoose').Types.ObjectId|string} userId
 * @returns {Promise<import('mongoose').Document[]>}
 */
export async function createDefaultCategories(userId) {
  return Category.insertMany([
    { user: userId, name: 'Pessoal' },
    { user: userId, name: 'Trabalho' },
    { user: userId, name: 'Compras' },
  ]);
}